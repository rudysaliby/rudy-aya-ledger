// Apple Pay hand-off: the iPhone "Transaction" automation posts merchant, amount and card here.
// GET or POST (form or JSON) /pay?key=…&by=Rudy&merchant=…&amount=…&card=…
import { HttpError, checkAuth, text, getSettings, getMonth, getAccounts, parseNote, saveExpenses, todayIn, fmt, memberName, guessTag, CURRENCIES } from "../lib/ledger.mjs";
import { matchCardAcc, withSync } from "../lib/flow.mjs";

export const config = { path: "/pay" };

/** "AED 84.00", "$12.50", "84,00 €", "USD 1,250" → {amount, currency} */
function parseMoney(s, fallback){
  s=String(s||'').trim(); if(!s) return {amount:0, currency:fallback};
  let currency=null;
  if(/\$/.test(s)||/\bUSD\b/i.test(s)) currency='USD';
  else if(/€/.test(s)||/\bEUR\b/i.test(s)) currency='EUR';
  else if(/\bAED\b|د\.إ|\bDH\b/i.test(s)) currency='AED';
  else if(/\bLBP\b|L\.L\.?|\bLL\b|ل\.ل/i.test(s)) currency='LBP';
  const m=s.match(/-?\d[\d.,\s]*/); if(!m) return {amount:0, currency:currency||fallback};
  let num=m[0].replace(/\s/g,'');
  // a comma is the decimal mark only when it is the single comma, comes after any dot and is followed by 1–2 digits
  // ("84,00" → 84.00, "1.234,56" → 1234.56); otherwise commas group thousands ("1,250" → 1250, "1,500,000" → 1500000)
  const lastDot=num.lastIndexOf('.'), lastComma=num.lastIndexOf(',');
  const commaDecimal = lastComma>lastDot && (num.match(/,/g)||[]).length===1 && /,\d{1,2}$/.test(num);
  if(commaDecimal){ num=num.replace(/\./g,'').replace(',','.'); } else { num=num.replace(/,/g,''); }
  return {amount: Math.abs(parseFloat(num))||0, currency: currency||fallback};
}

export default async (req) => {
  try{
    checkAuth(req);
    const url=new URL(req.url); const q=k=>url.searchParams.get(k)||'';
    let merchant=q('merchant'), amountText=q('amount'), card=q('card'), by=q('by'), status=q('status');
    if(req.method==='POST'){
      const ct=req.headers.get('content-type')||'';
      let b={};
      if(ct.includes('json')) b=await req.json().catch(()=>({}));
      else if(ct.includes('form')){ const f=await req.formData().catch(()=>null); if(f) for(const [k,v] of f.entries()) b[k]=v; }
      merchant=b.merchant||merchant; amountText=b.amount!=null?String(b.amount):amountText; card=b.card||card; by=b.by||by; status=b.status||status;
    }
    merchant=String(merchant||'').trim().slice(0,120); card=String(card||'').trim().slice(0,60);
    if(/refund|declined|failed|reversed/i.test(status)) return text('Ignored: '+status);
    const settings=await getSettings();
    const money=parseMoney(amountText, settings.base);
    if(!(money.amount>0)) return text("No amount received.", 400);
    const today=todayIn(settings.timezone); const mk=today.slice(0,7);
    // ignore a repeat of the same transaction within 10 minutes (Wallet can fire more than once)
    // ignore a repeat of the same payment within 10 minutes (Wallet firing twice, or the bank's SMS for the same purchase)
    const dup=(await getMonth(mk)).some(e=>Math.abs(e.amount-money.amount)<0.005 && e.currency===money.currency && Date.now()-e.ts<10*60*1000);
    if(dup) return text('Already logged.');
    const who=memberName(settings, by)||String(by||'').slice(0,40);
    const note=`${money.currency} ${money.amount} at ${merchant||'card payment'}`;
    let items;
    try{ const r=await parseNote(settings, note, today); items=r.items; }catch(e){ items=null; }
    if(!items||!items.length||!(items[0].amount>0)) items=[{amount:money.amount, currency:money.currency, description: merchant||'Card payment', tag:guessTag(merchant), date:today, by:null, note:null}];
    // trust the card's own amount and currency over the model's reading; the account is the card named in the pass
    // (its last digits, if the pass says them, pick a credit card or a debit card's bank), else this member's credit card
    const accounts=await getAccounts(); const l4=(card.match(/(\d{4})(?!.*\d)/)||[])[1]||null;
    const byL4 = l4 ? accounts.find(a=>a.active!==false && (a.type==='card'||a.type==='bank') && String(a.last4||'')===l4) : null;
    const acc = byL4 || matchCardAcc(accounts, {last4:null, owner:who});
    items=[{...items[0], kind:'expense', amount:money.amount, currency:CURRENCIES.includes(money.currency)?money.currency:settings.base, by:items[0].by||null, note: card? 'Apple Pay · '+card : 'Apple Pay', from: acc? acc.id : null, raw: merchant+'|'+money.amount+'|'+money.currency}];
    const saved=await withSync(settings, today, [acc? acc.id : null], ()=>saveExpenses(settings, items, {by:who, source:'applepay'}));
    const s=saved[0];
    console.log('[pay]', JSON.stringify({merchant, amount:money.amount, currency:money.currency, desc:s.desc, tag:s.tag}));
    return text(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by?' for '+s.by:''}.`);
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return text(status===401 ? 'The household key is wrong.' : ('Could not save: '+(e.message||'server error')), status);
  }
};
