// Bank SMS hand-off: the iPhone "Message" automation posts the alert text here.
// GET or POST (form or JSON) /sms?key=…&by=Rudy&text=…
import { HttpError, checkAuth, text, getSettings, getMonth, saveExpenses, todayIn, weekdayIn, fmt, memberName, guessTag, claudeMessage, parseModel, TAGS, CURRENCIES } from "../lib/ledger.mjs";

export const config = { path: "/sms" };

async function readAlert(settings, sms, today){
  const system = `You read one bank or card alert SMS and extract the transaction. Reply with only JSON, no prose, no code fences.
Today: ${today} (${weekdayIn(settings.timezone)}). Default currency: ${settings.base}. Currencies in use: USD, LBP (Lebanese lira), EUR, AED (UAE dirhams).
Tags, pick exactly one: ${TAGS.join(', ')}.
Shape: {"kind": "purchase"|"refund"|"payment_received"|"declined"|"otp"|"other", "amount": number, "currency": "USD"|"LBP"|"EUR"|"AED", "merchant": string, "description": string, "tag": string, "date": "YYYY-MM-DD"}
Rules: kind is "purchase" only for money spent with the card (POS, online, contactless, ATM withdrawal counts as purchase with tag Fees). A one-time code, balance notice, card payment received, salary credit, declined attempt or refund is not a purchase. amount is the transaction amount, never the available balance or limit. merchant is the raw merchant text; description is a clean 2-5 word Title Case name of the merchant (strip city codes, asterisks, card numbers). date is the transaction date if the SMS gives one, else today.`;
  const res = await claudeMessage({ model: parseModel(), system, max_tokens: 300, messages:[{role:'user', content:`SMS: """${sms.replace(/"""/g,'"')}"""`}] });
  const data = await res.json();
  const out = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const m = out.match(/\{[\s\S]*\}/); if(!m) throw new HttpError(502,'Claude did not return JSON.');
  return JSON.parse(m[0]);
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
    let a;
    try{ a=await readAlert(settings, sms, today); }
    catch(e){
      // no Claude: only accept an obvious spend with a currency marker, never a code or balance notice
      const spend=/\b(used|purchase|spent|transaction|paid|debited|charged)\b/i.test(sms) && /(AED|USD|LBP|EUR|\$|€|L\.L)/i.test(sms) && !/\b(code|OTP|password)\b/i.test(sms);
      if(!spend) return text('Ignored.');
      const m=sms.match(/(AED|USD|LBP|EUR|\$|€)\s*([\d,]+(?:\.\d+)?)/i) || sms.match(/([\d,]+(?:\.\d+)?)\s*(AED|USD|LBP|EUR)/i);
      if(!m) return text('Ignored.');
      const cur=(m[1].length<=3 && /[A-Z]{3}/i.test(m[1]))? m[1].toUpperCase() : (/[A-Z]{3}/i.test(m[2]||'')? m[2].toUpperCase() : (m[1]==='$'?'USD':'EUR'));
      const amt=parseFloat((m[2].match(/[\d.,]+/)? m[2] : m[1]).replace(/,/g,''));
      const merch=(sms.match(/\bat\s+([A-Z0-9][^.\n]{2,40})/i)||[])[1]||'Card payment';
      a={kind:'purchase', amount:amt, currency:cur, merchant:merch, description:merch, tag:guessTag(merch), date:today};
    }
    if(a.kind!=='purchase') return text('Ignored: '+(a.kind||'not a purchase'));
    const amount=Math.abs(Number(a.amount))||0; if(!(amount>0)) return text('Ignored: no amount.');
    const currency=CURRENCIES.includes(String(a.currency||'').toUpperCase())? String(a.currency).toUpperCase() : settings.base;
    const date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||'')? a.date : today; const mk=date.slice(0,7);
    // de-duplicate against anything logged in the last 10 minutes with the same amount (Apple Pay feed, a repeated SMS)
    const dup=(await getMonth(mk)).some(e=>Math.abs(e.amount-amount)<0.005 && e.currency===currency && Date.now()-e.ts<10*60*1000);
    if(dup) return text('Already logged.');
    const who=memberName(settings, by)||String(by||'').slice(0,40);
    const items=[{amount, currency, description:String(a.description||a.merchant||'Card payment').slice(0,80), tag:TAGS.includes(a.tag)?a.tag:guessTag(String(a.merchant||'')), date, by:null, note:'Card alert', raw:'sms|'+String(a.merchant||'').slice(0,60)+'|'+amount+'|'+currency}];
    const saved=await saveExpenses(settings, items, {by:who, source:'sms'});
    const s=saved[0];
    return text(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by?' for '+s.by:''}.`);
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return text(status===401 ? 'The household key is wrong.' : ('Could not save: '+(e.message||'server error')), status);
  }
};
