// Shared backend logic: storage, auth, Claude calls, parsing and analysis.
import { getStore } from "@netlify/blobs";

export const TAGS = ['Groceries','Dining','Coffee','Transport','Fuel','Kids','School','Health','Pharmacy','Home','Utilities','Shopping','Clothes','Beauty','Entertainment','Travel','Gifts','Pets','Fees','Other'];
export const CURRENCIES = ['USD','LBP','EUR','AED'];
export const DEFAULT_SETTINGS = { members:['Rudy','Aya'], people:['Noah'], base:'USD', rates:{USD:1, LBP:89500, EUR:0.92, AED:3.6725}, budget:null, timezone:'Asia/Beirut', goldPrice:null };
export const ACCOUNT_TYPES = ['cash','bank','savings','investment','gold','loan','card'];
export const LIABILITY_TYPES = ['loan','card'];

const TAG_WORDS = {
  Groceries:['grocer','spinneys','carrefour','supermarket','market','vegetable','fruit','bread','milk','chicken','meat','eggs','dekkeneh','minimarket','charcutier'],
  Dining:['restaurant','dinner','lunch','breakfast','burger','pizza','sushi','shawarma','manouche','manoushe','manakish','delivery','toters','takeout','brunch','meal'],
  Coffee:['coffee','cafe','café','latte','espresso','starbucks','dunkin','tea'],
  Transport:['uber','bolt','taxi','bus','parking','toll','valet','careem'],
  Fuel:['fuel','petrol','gas station','benzine','benzin','diesel','gasoline'],
  Kids:['kids','baby','toys','diapers','nursery','daycare','babysit','toy','stroller'],
  School:['school','tuition','books','stationery','uniform','tutoring','university','course'],
  Health:['doctor','dentist','clinic','hospital','lab','x-ray','checkup','therapy','optician','glasses'],
  Pharmacy:['pharmacy','medicine','meds','vitamins','prescription','panadol','advil'],
  Home:['furniture','ikea','repair','plumber','electrician','cleaning','maintenance','decor','garden','paint'],
  Utilities:['electricity','edl','generator','moteur','water','internet','ogero','wifi','alfa','touch','mobile','bill'],
  Shopping:['amazon','shopping','store','mall','electronics','gadget','order'],
  Clothes:['clothes','shoes','shirt','dress','jeans','zara','h&m','jacket','sneakers'],
  Beauty:['hair','salon','barber','nails','spa','cosmetics','makeup','perfume','skincare'],
  Entertainment:['cinema','movie','netflix','spotify','concert','game','tickets','theatre','bar','drinks','club','beach','pool'],
  Travel:['flight','hotel','airbnb','trip','ticket','visa','train','booking','airport'],
  Gifts:['gift','present','birthday','wedding','flowers','donation','charity','zakat'],
  Pets:['vet','pet','dog','cat'],
  Fees:['fee','bank','transfer','omt','whish','insurance','tax','fine','commission','withdrawal'],
};

// ---------- env & auth ----------
function env(name){ try{ if(typeof Netlify!=='undefined' && Netlify.env) { const v=Netlify.env.get(name); if(v!=null) return v; } }catch(e){} return process.env[name]; }
export function requireEnv(name){ const v=env(name); if(!v) throw new HttpError(500, `Server is missing the ${name} setting. Add it under Site configuration → Environment variables in Netlify, then redeploy.`); return v; }
export class HttpError extends Error { constructor(status, message){ super(message); this.status=status; } }
export function checkAuth(req){
  const key = requireEnv('HOUSEHOLD_KEY');
  const url = new URL(req.url);
  const given = req.headers.get('x-ledger-key') || (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'') || url.searchParams.get('key') || '';
  if(!given || given !== key) throw new HttpError(401, 'Wrong household key.');
}
export function json(data, status=200){ return new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}); }
export function text(s, status=200){ return new Response(s, {status, headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}}); }

// ---------- storage ----------
export function store(){ return getStore({ name:'ledger', consistency:'strong' }); }
export async function readJSON(key, fallback){ const v = await store().get(key, {type:'json'}); return v==null ? fallback : v; }
export async function writeJSON(key, data){ await store().setJSON(key, data); }
export async function getSettings(){ const s = await readJSON('settings', null); return s ? {...DEFAULT_SETTINGS, ...s, rates:{...DEFAULT_SETTINGS.rates, ...(s.rates||{})}} : {...DEFAULT_SETTINGS, rates:{...DEFAULT_SETTINGS.rates}}; }
export async function getMonth(mk){ const m = await readJSON('months/'+mk, null); return (m && Array.isArray(m.items)) ? m.items : []; }
export async function putMonth(mk, items){ await writeJSON('months/'+mk, {items}); }
export async function getRecurring(){ const r = await readJSON('recurring', null); return (r && Array.isArray(r.items)) ? r.items : []; }
export async function getIncome(){ const r = await readJSON('income', null); return (r && Array.isArray(r.items)) ? r.items : []; }
export async function getAccounts(){ const r = await readJSON('accounts', null); return (r && Array.isArray(r.items)) ? r.items : []; }
export async function getNetworthPoints(){ const r = await readJSON('networth', null); return (r && Array.isArray(r.points)) ? r.points : []; }
/** USD value of one account; gold uses grams × settings.goldPrice (USD per gram) unless an amount is given directly. */
export function accountUSD(settings, a){
  if(a.type==='gold'){ const g=Number(a.grams)||0; const price=Number(settings.goldPrice)||0; if(g>0 && price>0) return g*price; }
  return toUSD(settings, a.amount, a.currency);
}
export function netWorth(settings, accounts){
  let assets=0, debts=0;
  for(const a of accounts){ if(a.active===false) continue; const v=accountUSD(settings,a); if(LIABILITY_TYPES.includes(a.type)) debts+=v; else assets+=v; }
  return {assets, debts, net: assets-debts};
}
/** Keep one net-worth point per day so the Wealth tab can draw a history line. */
export async function recordSnapshot(settings, accounts, today){
  const {assets,debts}=netWorth(settings, accounts);
  const pts=(await getNetworthPoints()).filter(p=>p.date!==today); pts.push({date:today, assets:Math.round(assets), debts:Math.round(debts)});
  pts.sort((a,b)=>a.date<b.date?-1:1); await writeJSON('networth', {points: pts.slice(-400)});
  return pts;
}
export function incomeMonthlyUSD(settings, items){ return items.filter(i=>i.active!==false).reduce((a,i)=>{ const u=toUSD(settings,i.amount,i.currency); return a+(i.period==='yearly'?u/12:u); },0); }
export async function putRecurring(items){ await writeJSON('recurring', {items}); }
/** Month keys that hold at least one document, oldest first. */
export async function listMonthKeys(){
  try{ const {blobs} = await store().list({prefix:'months/'}); return blobs.map(b=>b.key.replace(/^months\//,'')).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort(); }
  catch(e){ return []; }
}
/** Read-modify-write one list document with an etag check, retried, so two phones saving at once never lose an entry. */
export async function mutateList(key, fn){
  const s = store();
  for(let attempt=0; attempt<5; attempt++){
    const cur = await s.getWithMetadata(key, {type:'json'});
    const items = (cur && cur.data && Array.isArray(cur.data.items)) ? cur.data.items : [];
    const next = fn(items.slice());
    const opts = cur && cur.etag ? {onlyIfMatch: cur.etag} : {onlyIfNew: true};
    let res;
    try{ res = await s.setJSON(key, {items: next}, opts); }
    catch(e){ if(attempt===4) throw e; res={modified:false}; }
    // Older library versions resolve undefined: treat that as a plain successful write.
    if(!res || res.modified !== false) return next;
    await new Promise(r=>setTimeout(r, 60 + Math.random()*120));
  }
  throw new HttpError(409, 'The ledger was busy. Try again.');
}

// ---------- dates & money ----------
export function todayIn(tz){ try{ return new Intl.DateTimeFormat('en-CA',{timeZone:tz||'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }catch(e){ return new Date().toISOString().slice(0,10); } }
export function weekdayIn(tz){ try{ return new Intl.DateTimeFormat('en-US',{timeZone:tz||'Asia/Beirut',weekday:'long'}).format(new Date()); }catch(e){ return ''; } }
export function shiftMonth(mk,n){ const [y,m]=mk.split('-').map(Number); const d=new Date(Date.UTC(y,m-1+n,1)); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'); }
export function daysInMonth(mk){ const [y,m]=mk.split('-').map(Number); return new Date(Date.UTC(y,m,0)).getUTCDate(); }
export function rate(settings,c){ const r=(settings.rates||{})[c]; return Number(r)>0 ? Number(r) : 1; }
export function toUSD(settings, amount, cur){ return Number(amount||0)/rate(settings,cur||'USD'); }
export function fmt(settings, usd){ const c=settings.base||'USD'; const v=usd*rate(settings,c); const dec=c==='LBP'?0:(Math.abs(v)%1<0.005?0:2); const n=v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}); return (c==='USD'?'$':c==='LBP'?'L.L. ':c==='EUR'?'€':c==='AED'?'AED ':c+' ')+n; }
export function newId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
export function memberName(settings, name){ if(!name) return null; const i=(settings.members||[]).findIndex(m=>m.toLowerCase()===String(name).toLowerCase()); return i>=0 ? settings.members[i] : null; }

// ---------- fallback parser (no Claude needed) ----------
const NUMWORDS = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100,thousand:1000,million:1000000};
function wordsToNumber(str){ const toks=str.toLowerCase().replace(/-/g,' ').split(/\s+/).filter(Boolean); let total=0,cur=0,found=false; for(const t of toks){ const v=NUMWORDS[t]; if(v==null){ if(t==='and') continue; if(found) break; else continue; } found=true; if(v===100){ cur=(cur||1)*100; } else if(v>=1000){ total+=(cur||1)*v; cur=0; } else cur+=v; } return found? total+cur : null; }
export function guessTag(t){ t=String(t).toLowerCase(); let best='Other',score=0; for(const [tag,words] of Object.entries(TAG_WORDS)){ for(const w of words){ if(t.includes(w) && w.length>score){ best=tag; score=w.length; } } } return best; }
export function parseLocal(settings, text, today){
  const raw=String(text).trim(); const t=raw.toLowerCase();
  let currency=settings.base||'USD';
  if(/\b(lira|lbp|l\.l\.?|ll|ليرة)\b/.test(t)) currency='LBP';
  else if(/\$|\b(usd|dollars?|bucks|دولار)\b/.test(t)) currency='USD';
  else if(/€|\b(eur|euros?)\b/.test(t)) currency='EUR';
  else if(/\b(aed|dirhams?|درهم)\b/.test(t)) currency='AED';
  let amount=null; const m=t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?/);
  if(m){ amount=parseFloat(m[1].replace(/,/g,'')); const mult=m[2]; if(mult==='k'||mult==='thousand') amount*=1000; if(mult==='m'||mult==='million') amount*=1e6; }
  else { const w=wordsToNumber(t); if(w!=null) amount=w; }
  let desc=raw.replace(/\$|€/g,'').replace(/\b\d[\d,]*(?:\.\d+)?\s*(k|m|thousand|million)?\b/ig,' ').replace(/\b(lira|lbp|l\.l\.?|ll|usd|dollars?|bucks|eur|euros?)\b/ig,' ');
  Object.keys(NUMWORDS).forEach(w=>{ desc=desc.replace(new RegExp('\\b'+w+'\\b','ig'),' '); });
  desc=desc.replace(/\b(for|on|at|of|spent|paid|bought|and|the|a|an|add|expense|expenses|to|my)\b/ig,' ').replace(/\s+/g,' ').trim();
  let by=null; for(const mname of (settings.members||[])){ if(new RegExp('\\b'+mname.toLowerCase()+'\\b').test(t)){ by=mname; desc=desc.replace(new RegExp('\\b'+mname+'\\b','ig'),' ').replace(/\s+/g,' ').trim(); } }
  let date=today; if(/\byesterday\b/.test(t)){ const d=new Date(today+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-1); date=d.toISOString().slice(0,10); desc=desc.replace(/yesterday/ig,'').trim(); }
  const tag=guessTag(t);
  desc=desc? desc.charAt(0).toUpperCase()+desc.slice(1) : tag;
  return [{amount: amount==null?0:amount, currency, description:desc, tag, date, by, note:null}];
}

// ---------- Claude ----------
export async function claudeMessage({model, system, messages, max_tokens=600, stream=false, signal}){
  const key = requireEnv('ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST', signal,
    headers:{ 'content-type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model, max_tokens, system, messages, stream }),
  });
  if(!res.ok){ let msg=''; try{ const e=await res.json(); msg=e.error?.message||JSON.stringify(e); }catch(e){ msg=await res.text(); } throw new HttpError(res.status===401?500:502, `Claude request failed (${res.status}): ${msg}`); }
  return res;
}
export function parseModel(){ return env('PARSE_MODEL') || 'claude-haiku-5-5'; }
export function analysisModel(){ return env('ANALYSIS_MODEL') || 'claude-sonnet-5-5'; }

export async function parseWithClaude(settings, textIn, today){
  const system = `You turn one short spoken or typed note into expense records for a household ledger. Reply with only a JSON array of one or more objects (most notes are exactly one expense). No prose, no code fences.
Today: ${today} (${weekdayIn(settings.timezone)}). Household members: ${settings.members.join(', ')}. Default currency: ${settings.base}. Other currencies in use: LBP (Lebanese lira; people say "lira", "L.L.", "500 thousand", "2 million" meaning lira), EUR, and AED (UAE dirhams; "dirhams", "AED").
Tags, pick exactly one per expense: ${TAGS.join(', ')}.
Object shape: {"amount": number, "currency": "USD"|"LBP"|"EUR"|"AED", "description": string, "tag": string, "date": "YYYY-MM-DD", "by": string|null, "note": string|null}
Rules: amount is the number spent (spoken numbers like "forty five" become 45; "1.2k" is 1200; "500 thousand lira" is 500000 LBP); the note may start with filler like "add to my expenses", ignore it; description is 2-6 words saying what or where, Title Case, with no amount or currency in it; date is today unless the note says otherwise (yesterday, last Tuesday, on the 3rd); by is a member name only when the note says who paid, else null; note keeps any leftover detail, else null. If no amount can be found, use 0.`;
  const res = await claudeMessage({ model: parseModel(), system, max_tokens: 400, messages:[{role:'user', content:`Note: """${String(textIn).replace(/"""/g,'"')}"""`}] });
  const data = await res.json();
  const out = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const m = out.match(/\[[\s\S]*\]|\{[\s\S]*\}/); if(!m) throw new HttpError(502,'Claude did not return JSON.');
  let parsed = JSON.parse(m[0]); if(!Array.isArray(parsed)) parsed=[parsed];
  return parsed.map(o=>({
    amount: Math.abs(Number(o.amount))||0,
    currency: CURRENCIES.includes(String(o.currency||'').toUpperCase())? String(o.currency).toUpperCase() : settings.base,
    description: String(o.description||'').trim().slice(0,80) || 'Expense',
    tag: TAGS.includes(o.tag)? o.tag : guessTag(String(o.description||'')+' '+textIn),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date||''))? o.date : today,
    by: memberName(settings, o.by),
    note: o.note? String(o.note).slice(0,200) : null,
  }));
}

/** Parse a note with Claude, falling back to the local parser. Returns {items, via}. */
export async function parseNote(settings, text, today){
  try{ const items = await parseWithClaude(settings, text, today); if(items.length) return {items, via:'claude'}; }
  catch(e){ return {items: parseLocal(settings, text, today), via:'local', error: e.message}; }
  return {items: parseLocal(settings, text, today), via:'local'};
}

/** Build stored expense objects and append them to their month documents. */
export async function saveExpenses(settings, items, {by, source}){
  const saved=[]; const byMonth={};
  for(const p of items){
    const date = p.date; const mk=date.slice(0,7); const cur=p.currency||settings.base;
    const doc = { id:newId(), amount:Number(p.amount)||0, currency:cur, usd:toUSD(settings,p.amount,cur), desc:p.description||p.desc||'Expense', tag:TAGS.includes(p.tag)?p.tag:'Other', by:p.by||by||'', date, month:mk, ts:Date.now(), source:source||'text', note:p.note||null };
    (byMonth[mk]=byMonth[mk]||[]).push(doc); saved.push(doc);
  }
  for(const [mk,docs] of Object.entries(byMonth)){ await mutateList('months/'+mk, items=>items.concat(docs)); }
  return saved;
}

// ---------- analysis ----------
export function monthStats(settings, items, recurring, mk, today){
  const byTag={}, byPerson={}; let total=0; const byDay={};
  for(const e of items){ total+=e.usd; byTag[e.tag]=(byTag[e.tag]||0)+e.usd; const p=e.by||'Unknown'; byPerson[p]=(byPerson[p]||0)+e.usd; const d=Number(e.date.slice(8,10)); byDay[d]=(byDay[d]||0)+e.usd; }
  const fixed=recurring.filter(r=>r.active!==false).reduce((a,r)=>{ const u=toUSD(settings,r.amount,r.currency); return a+(r.period==='yearly'?u/12:u); },0);
  const dim=daysInMonth(mk); const cm=today.slice(0,7); const elapsed = mk===cm? Number(today.slice(8,10)) : (mk<cm? dim : 0);
  return {items,total,byTag,byPerson,byDay,fixed,dim,elapsed,count:items.length};
}
export const monthLabel=k=>{ const [y,m]=k.split('-').map(Number); return new Date(Date.UTC(y,m-1,1)).toLocaleString('en-US',{month:'long',year:'numeric',timeZone:'UTC'}); };
export function analysisPrompt(settings, mk, st, m1, m2, recurring, today, incomeUSD=0, wealth=null){
  const usd=v=>Math.round(v);
  const tagLine=s=>Object.entries(s.byTag).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`${t} ${usd(v)}`).join(', ')||'none';
  const perLine=s=>Object.entries(s.byPerson).map(([p,v])=>`${p} ${usd(v)}`).join(', ')||'none';
  const big=[...st.items].sort((a,b)=>b.usd-a.usd).slice(0,8).map(e=>`${e.date.slice(5)} ${e.desc} (${e.tag}, ${e.by||'?'}) ${usd(e.usd)}`).join('; ')||'none';
  const recs=recurring.filter(r=>r.active!==false).map(r=>{ const u=toUSD(settings,r.amount,r.currency); return `${r.name} [${r.kind||'other'}] ${usd(r.period==='yearly'?u/12:u)}/mo${r.period==='yearly'?' (billed yearly)':''}`; }).join('; ')||'none';
  const budget=Number(settings.budget)? `Monthly budget: ${usd(toUSD(settings, settings.budget, settings.base))}.` : 'No budget set.';
  const projected = st.elapsed? st.total/st.elapsed*st.dim : st.total;
  const incomeLine = incomeUSD>0 ? `Household income: ${usd(incomeUSD)} per month. Projected left over this month after day-to-day and fixed costs: ${usd(incomeUSD-projected-st.fixed)} (${Math.round((incomeUSD-projected-st.fixed)/incomeUSD*100)}% of income).` : 'Income not recorded.';
  const label=monthLabel;
  return {
    system: coachSystem(settings),
    user: `Month in view: ${label(mk)}, ${st.elapsed} of ${st.dim} days elapsed. Day-to-day total ${usd(st.total)} across ${st.count} items, daily average ${st.elapsed? usd(st.total/st.elapsed):0}, projected month-end day-to-day ${st.elapsed? usd(st.total/st.elapsed*st.dim):0}.
By category: ${tagLine(st)}. By person: ${perLine(st)}.
Largest items: ${big}.
Previous month (${label(shiftMonth(mk,-1))}, full): total ${usd(m1.total)}; by category: ${tagLine(m1)}; by person: ${perLine(m1)}.
Two months ago (${label(shiftMonth(mk,-2))}): total ${usd(m2.total)}; by category: ${tagLine(m2)}.
Fixed monthly costs (${usd(st.fixed)}/mo in total): ${recs}.
${incomeLine}
${wealthLine(wealth, st.total+st.fixed)}
${budget}`,
  };
}
function wealthLine(w, monthlySpend){
  if(!w || (!w.assets && !w.debts)) return '';
  const usd=v=>Math.round(v); const runway = monthlySpend>0 ? (w.liquid/monthlySpend).toFixed(1) : 'n/a';
  return `Balances today: assets ${usd(w.assets)} (of which liquid cash and bank ${usd(w.liquid)}), debts ${usd(w.debts)}, net worth ${usd(w.net)}. Liquid savings cover about ${runway} months of total spending. Mention this in "Fixed costs" or "Try this" only when it changes the advice (for example an expensive debt worth paying down, or a thin cushion).`;
}
function coachSystem(settings){
  return `You are a careful, friendly household finance coach for a two-person household (${settings.members.join(' and ')}) living in Lebanon. Reply in plain text only (no markdown symbols such as # or **), at most 230 words, using exactly these short section titles on their own lines: Headline / Watch out / Try this / Fixed costs. In "Watch out" name the categories or items that look high or unusual with their numbers. In "Try this" give 3 concrete, specific changes, each with a rough monthly saving in dollars. In "Fixed costs" say in one or two sentences how large subscriptions and staff salaries are relative to everything and whether anything there deserves a second look. When household income is given, open the Headline with how much of it is left over (the savings rate) and whether that is healthy. Be specific to the numbers; no generic advice; no greetings. Amounts are in USD.`;
}
/** Prompt for a range of months (2 or more). perMonth: [{mk, st}] oldest first; prior: stats for the same number of months before the range. */
export function rangeAnalysisPrompt(settings, perMonth, prior, recurring, incomeUSD=0, wealth=null){
  const usd=v=>Math.round(v);
  const agg={byTag:{},byPerson:{},total:0,count:0,items:[]};
  for(const {st} of perMonth){ agg.total+=st.total; agg.count+=st.count; agg.items.push(...st.items); for(const [t,v] of Object.entries(st.byTag)) agg.byTag[t]=(agg.byTag[t]||0)+v; for(const [p,v] of Object.entries(st.byPerson)) agg.byPerson[p]=(agg.byPerson[p]||0)+v; }
  const n=perMonth.length; const fixed=perMonth[0].st.fixed;
  const tagLine=s=>Object.entries(s.byTag).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`${t} ${usd(v)} (${usd(v/n)}/mo)`).join(', ')||'none';
  const perLine=s=>Object.entries(s.byPerson).map(([p,v])=>`${p} ${usd(v)}`).join(', ')||'none';
  const months=perMonth.map(({mk,st})=>`${monthLabel(mk)} ${usd(st.total)}`).join(', ');
  const big=[...agg.items].sort((a,b)=>b.usd-a.usd).slice(0,8).map(e=>`${e.date} ${e.desc} (${e.tag}, ${e.by||'?'}) ${usd(e.usd)}`).join('; ')||'none';
  const recs=recurring.filter(r=>r.active!==false).map(r=>{ const u=toUSD(settings,r.amount,r.currency); return `${r.name} [${r.kind||'other'}] ${usd(r.period==='yearly'?u/12:u)}/mo`; }).join('; ')||'none';
  const budget=Number(settings.budget)? `Monthly budget: ${usd(toUSD(settings, settings.budget, settings.base))}.` : 'No budget set.';
  const priorLine = prior && prior.total ? `The ${n} months before that: day-to-day total ${usd(prior.total)} (${usd(prior.total/n)}/mo); by category: ${Object.entries(prior.byTag).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`${t} ${usd(v)}`).join(', ')||'none'}.` : 'No data for the months before this range.';
  return {
    system: coachSystem(settings).replace('Month in view','Period in view') + ' The data covers several months: talk about monthly averages and the trend from month to month, and name the months where spending jumped.',
    user: `Period in view: ${monthLabel(perMonth[0].mk)} to ${monthLabel(perMonth[n-1].mk)} (${n} months). Day-to-day per month: ${months}. Total ${usd(agg.total)} across ${agg.count} items, average ${usd(agg.total/n)} per month.
By category over the period: ${tagLine(agg)}. By person: ${perLine(agg)}.
Largest single items: ${big}.
${priorLine}
Fixed monthly costs (${usd(fixed)}/mo in total, ${usd(fixed*n)} over the period): ${recs}.
${incomeUSD>0 ? `Household income: ${usd(incomeUSD)} per month, ${usd(incomeUSD*n)} over the period; left over after all spending: ${usd(incomeUSD*n-agg.total-fixed*n)} (${Math.round((incomeUSD*n-agg.total-fixed*n)/(incomeUSD*n)*100)}% of income).` : 'Income not recorded.'}
${wealthLine(wealth, agg.total/n+fixed)}
${budget}`,
  };
}
