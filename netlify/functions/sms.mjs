// Bank SMS hand-off: the iPhone "Message" automation posts the alert text here.
// Every alert becomes a movement: an expense from an account, a transfer between accounts, income landing, or a balance reading.
import { HttpError, checkAuth, text, getSettings, getMonth, getAccounts, getIncome, saveExpenses, todayIn, weekdayIn, fmt, fmtAmount, memberName, guessTag, claudeMessage, parseModel, toUSD, rate, TAGS, CURRENCIES } from "../lib/ledger.mjs";
import { saveMove, getMoves, matchBank, matchCardAcc, accountOfType, isCashOut, applyReading, applyCardPayment, withSync } from "../lib/flow.mjs";

export const config = { path: "/sms" };

async function readAlert(settings, sms, today){
  const system = `You read one bank or card alert SMS and extract what happened. Reply with only JSON, no prose, no code fences.
Today: ${today} (${weekdayIn(settings.timezone)}). Currencies in use: USD, LBP (Lebanese lira), EUR, AED (UAE dirhams).
Tags, pick exactly one for purchases: ${TAGS.join(', ')}.
Shape: {"kind": "purchase"|"withdrawal"|"credit_in"|"card_payment"|"fee"|"refund"|"declined"|"otp"|"other", "amount": number, "currency": "USD"|"LBP"|"EUR"|"AED", "account": "card"|"bank"|null, "card_last4": string|null, "account_mask": string|null, "merchant": string, "description": string, "tag": string, "date": "YYYY-MM-DD", "available": number|null, "available_kind": "limit"|"balance"|null, "available_currency": "USD"|"LBP"|"EUR"|"AED"|null}
How to read it:
- account is the account whose balance the alert reports: "card" when it ends with "available limit" (a credit card); "bank" when it ends with "available balance" or names an account number like 032-401***-001 (a current/savings account), even if the text mentions a credit card as the payee ("Payment to Credit Card ending 9821 from 032-401***-001 … available balance" is account "bank", kind "card_payment").
- kind: "purchase" = money spent at a merchant (a credit-card use, or a debit "Purchase from <account> … AED 123.45-"); "withdrawal" = ATM / cash withdrawal; "credit_in" = money received into the account (an amount with a trailing "+", "TT Payment to <account>", salary, transfer in); "card_payment" = a payment to or received on a credit card; "fee" = bank fee, interest, charges; "refund" = reversal/refund; "declined", "otp" (one-time code), "other" (balance notice, promotions, reminders).
- amount is the transaction amount in its own currency (a credit card used for LBP 122,950,000.00 has amount 122950000 and currency LBP even if the available limit is in AED). Never use the available balance or limit as the amount.
- available is the figure after "Your available limit is" (available_kind "limit", a credit card) or "Your available balance is" (available_kind "balance", a bank account), with its currency; null if absent.
- card_last4: digits after "ending with" / "Card Ending with"; account_mask: the masked account number exactly as written (e.g. 032-401***-001).
- merchant is the raw merchant text; description is a clean 2-5 word Title Case name (ZARA → Zara; PATCHI DBAYE → Patchi Dbaye; Careem Deliveries FZ → Careem Deliveries). date is the transaction date in the SMS (DD/MM/YYYY) as YYYY-MM-DD, else today.`;
  const res = await claudeMessage({ model: parseModel(), system, max_tokens: 350, messages:[{role:'user', content:`SMS: """${sms.replace(/"""/g,'"')}"""`}] });
  const data = await res.json();
  const out = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const m = out.match(/\{[\s\S]*\}/); if(!m) throw new HttpError(502,'Claude did not return JSON.');
  return JSON.parse(m[0]);
}

/** Regex reading for when Claude is unreachable: handles the HSBC formats seen so far. */
function readAlertLocal(sms, today){
  const money=sms.match(/\b(AED|USD|LBP|EUR)\s*([\d,]+(?:\.\d+)?)\s*([+-])?/i); if(!money) return {kind:/code|OTP|password/i.test(sms)?'otp':'other'};
  const currency=money[1].toUpperCase(), amount=parseFloat(money[2].replace(/,/g,'')), sign=money[3]||'';
  const av=sms.match(/available\s+(limit|balance)\s+is\s+(AED|USD|LBP|EUR)\s*([\d,]+(?:\.\d+)?)/i);
  const last4=(sms.match(/(?:ending with|Card Ending with)\s*\**\s*(\d{4})\b/i)||[])[1]||null;
  const mask=(sms.match(/\b(\d{3}-\d{3}\*+-\d{3})\b/)||[])[1]||null;
  const d=sms.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/); const date=d? `${d[3]}-${d[2]}-${d[1]}` : today;
  const account = av? (av[1].toLowerCase()==='limit'?'card':'bank') : (/your credit card/i.test(sms)? 'card' : (mask? 'bank' : null));
  let kind='other', merchant='';
  if(/code|OTP|password/i.test(sms)) kind='otp';
  else if(/declined/i.test(sms)) kind='declined';
  else if(/refund|revers/i.test(sms)) kind='refund';
  else if(/ATM|cash withdrawal/i.test(sms)) kind='withdrawal';
  else if(/payment (?:to|received on) .*credit card|credit card payment/i.test(sms)) kind='card_payment';
  else if(sign==='+' || /payment to \d{3}-\d{3}|credited|salary/i.test(sms)) kind='credit_in';
  else if(/has been used for|purchase from/i.test(sms) || sign==='-') kind='purchase';
  else if(/fee|interest|charge/i.test(sms)) kind='fee';
  const at=sms.match(/\bat\s+([A-Z0-9][^.\n]{1,40}?)(?=\.\s|\.$|\s+on\b)/i); if(at) merchant=at[1].trim();
  else { const pf=sms.match(/\d{2}:\d{2}:\d{2}\s+(.+?)\s+Purchase from/i); if(pf) merchant=pf[1].trim(); }
  const desc=merchant? merchant.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).replace(/\s+(fz|llc|dmcc|ltd)\b/i,'') : (kind==='credit_in'?'Money received':'Card payment');
  return {kind, amount, currency, account, card_last4:last4, account_mask:mask, merchant, description:desc, tag:guessTag(merchant), date, available: av? parseFloat(av[3].replace(/,/g,'')) : null, available_kind: av? av[1].toLowerCase() : null, available_currency: av? av[2].toUpperCase() : null};
}

export default async (req) => {
  try{
    checkAuth(req);
    const url=new URL(req.url); let sms=url.searchParams.get('text')||''; let by=url.searchParams.get('by')||'';
    if(req.method==='POST'){
      const ct=req.headers.get('content-type')||'';
      if(ct.includes('json')){ const b=await req.json().catch(()=>({})); sms=b.text||sms; by=b.by||by; }
      else if(ct.includes('form')){ const f=await req.formData().catch(()=>null); if(f){ sms=f.get('text')||sms; by=f.get('by')||by; } }
      else { const t=await req.text().catch(()=>''); if(t && !sms) sms=t; }
    }
    sms=String(sms||'').trim().slice(0,1000);
    if(!sms) return text('No message text received.', 400);
    const settings=await getSettings(); const today=todayIn(settings.timezone);
    const who=memberName(settings, by)||String(by||'').slice(0,40);
    let a; try{ a=await readAlert(settings, sms, today); }catch(e){ a=readAlertLocal(sms, today); }
    if(['otp','declined','other'].includes(a.kind) && a.available==null) return text('Ignored: '+(a.kind||'other'));
    const amount=Math.abs(Number(a.amount))||0;
    const currency=CURRENCIES.includes(String(a.currency||'').toUpperCase())? String(a.currency).toUpperCase() : settings.base;
    const date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||'')? a.date : today; const mk=date.slice(0,7);
    const accounts=await getAccounts();
    // which account does this alert talk about?
    const isCard = a.available_kind==='limit' || (a.available_kind!=='balance' && a.account==='card');
    const acc = isCard ? matchCardAcc(accounts,{last4:a.card_last4, owner:who}) : matchBank(accounts,{mask:a.account_mask, last4:a.card_last4, owner:who});
    const accName = acc? acc.name : (isCard?'credit card':'bank account');
    const notes=[];
    // de-duplicate against anything logged in the last 10 minutes with the same amount (Apple Pay feed, a repeated SMS)
    const recentExp=(await getMonth(mk)), recentMv=(await getMoves(mk));
    const dup = amount>0 && (recentExp.some(e=>Math.abs(e.amount-amount)<0.005 && e.currency===currency && Date.now()-e.ts<10*60*1000) || recentMv.some(m=>Math.abs(m.amount-amount)<0.005 && m.currency===currency && Date.now()-m.ts<10*60*1000));
    let headline='';
    if(!dup && amount>0){
      const kind = (a.kind==='purchase' && !isCard && isCashOut(settings, a.merchant||a.description)) ? 'withdrawal' : a.kind;
      const raw='sms|'+kind+'|'+String(a.merchant||'').slice(0,60)+'|'+amount+'|'+currency;
      if(kind==='purchase' || kind==='fee'){
        const items=[{amount, currency, description:String(a.description||a.merchant||'Card payment').slice(0,80), tag: kind==='fee'?'Fees':(TAGS.includes(a.tag)?a.tag:guessTag(String(a.merchant||''))), date, by:null, note: isCard? 'Card alert' : 'Bank alert', from: acc? acc.id : null, raw}];
        const s=(await withSync(settings, today, [acc?acc.id:null], ()=>saveExpenses(settings, items, {by:who, source:'sms'})))[0];
        headline=`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by?' for '+s.by:''}${acc?' from '+acc.name:''}.`;
      } else if(kind==='withdrawal'){
        const cash=await accountOfType(settings, accounts, 'cash', who, {create:true, currency:'USD'});
        const m=await withSync(settings, today, [acc?acc.id:null, cash?cash.id:null], ()=>saveMove(settings, {kind:'transfer', fromAcc: acc? acc.id : null, toAcc: cash? cash.id : null, amount, currency, desc:'Cash withdrawal'+(a.merchant? ' via '+String(a.description||a.merchant).slice(0,30):''), date, raw}, {by:who, source:'sms'}));
        headline=`Moved ${fmt(settings, m.usd)} from ${accName} to ${cash? cash.name : 'cash'}.`;
      } else if(kind==='credit_in'){
        // salary or other money in: link to a planned income line when the amount is close (±20%)
        const income=await getIncome(); const usd=toUSD(settings, amount, currency);
        const cands=income.filter(i=>i.active!==false && i.period==='monthly' && (!i.by || !who || String(i.by).toLowerCase()===String(who).toLowerCase()));
        const hit=cands.find(i=>{ const u=toUSD(settings,i.amount,i.currency); return u>0 && Math.abs(usd-u)/u<=0.2; });
        const already = hit && recentMv.some(m=>m.kind==='income' && m.incomeId===hit.id);
        const m=await withSync(settings, today, [acc?acc.id:null], ()=>saveMove(settings, {kind: hit? 'income' : 'adjust', fromAcc:null, toAcc: acc? acc.id : null, amount, currency, desc: hit? (already? hit.name+' (again)' : hit.name) : 'Money received'+(a.description&&a.description!=='Money received'? ' · '+String(a.description).slice(0,40):''), date, incomeId: hit? hit.id : null, raw}, {by:who, source:'sms'}));
        headline= hit? `${hit.name} received: ${fmt(settings, m.usd)} into ${accName}.` : `${fmt(settings, m.usd)} received into ${accName} (not matched to a salary; it counts as an adjustment).`;
      } else if(kind==='card_payment'){
        const card = isCard? acc : matchCardAcc(accounts,{last4:a.card_last4, owner:who}); const bank = isCard? matchBank(accounts,{owner:who}) : acc;
        const m=await withSync(settings, today, [bank?bank.id:null, card?card.id:null], ()=>saveMove(settings, {kind:'transfer', fromAcc: bank? bank.id : null, toAcc: card? card.id : null, amount, currency, desc:'Credit card payment', date, raw}, {by:who, source:'sms'}));
        if(card){ try{ await applyCardPayment(card.id, toUSD(settings, amount, currency)*rate(settings, card.currency)); }catch(e){} }
        headline=`Card payment of ${fmt(settings, m.usd)} recorded${bank?' from '+bank.name:''}${card?' to '+card.name:''}.`;
      } else if(kind==='refund'){
        const m=await withSync(settings, today, [acc?acc.id:null], ()=>saveMove(settings, {kind:'refund', fromAcc:null, toAcc: acc? acc.id : null, amount, currency, desc:'Refund'+(a.description? ' · '+String(a.description).slice(0,40):''), date, raw}, {by:who, source:'sms'}));
        headline=`Refund of ${fmt(settings, m.usd)} into ${accName}.`;
      }
    } else if(dup) headline='Already logged.';
    // any stated available balance / limit sets the account's actual balance
    if(acc && a.available!=null && Number(a.available)>=0){
      try{ const r=await applyReading(settings, acc, Number(a.available), a.available_currency||null, today); if(r) notes.push(acc.type==='card'? `Card debt now ${fmtAmount(r.account.amount, acc.currency)}.` : `${acc.name} balance now ${fmtAmount(r.account.amount, acc.currency)}.`); }catch(e){}
    } else if(!acc && a.available!=null){ notes.push(isCard? 'No credit-card account matched this alert; add one in Wealth with the card\'s last digits.' : 'No bank account matched this alert; add one in Wealth with the account number mask.'); }
    return text((headline||'Nothing to add.')+(notes.length?' '+notes.join(' '):''));
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return text(status===401 ? 'The household key is wrong.' : ('Could not save: '+(e.message||'server error')), status);
  }
};
