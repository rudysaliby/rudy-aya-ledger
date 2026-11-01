// Money flow: movements between accounts, account matching for bank alerts, and expected-vs-actual balances.
import { HttpError, readJSON, mutateList, getAccounts, getMonth, getIncome, recordSnapshot, toUSD, rate, newId, shiftMonth, bucketOf, listKeys } from "./ledger.mjs";

export const MOVE_KINDS = ['transfer','income','refund','adjust'];
export const FLOW_TYPES = ['cash','bank','savings','card'];   // accounts that take part in the monthly check

// ---------- moves: transfers, income landed, refunds, adjustments ----------
export async function getMoves(mk){ const m = await readJSON('moves/'+mk, null); return (m && Array.isArray(m.items)) ? m.items : []; }
/** Save one movement. amount is in `currency`; fromAcc/toAcc are account ids (either may be null). */
export async function saveMove(settings, m, {by, source}){
  const date=/^\d{4}-\d{2}-\d{2}$/.test(m.date||'')? m.date : null; if(!date) throw new HttpError(400,'Bad date');
  const cur=m.currency||settings.base; const amount=Math.abs(Number(m.amount))||0; if(!(amount>0)) throw new HttpError(400,'Amount required');
  const doc={ id:m.id||newId(), kind:MOVE_KINDS.includes(m.kind)?m.kind:'transfer', fromAcc:m.fromAcc||null, toAcc:m.toAcc||null, amount, currency:cur, usd:toUSD(settings,amount,cur), desc:String(m.desc||'').slice(0,80)||kindLabel(m.kind), date, month:date.slice(0,7), ts:m.ts||Date.now(), source:source||'manual', by:String(m.by||by||'').slice(0,40), incomeId:m.incomeId||null, note:m.note?String(m.note).slice(0,120):null, ...(m.raw?{raw:String(m.raw).slice(0,200)}:{}) };
  await mutateList('moves/'+doc.month, items=>{ const i=items.findIndex(x=>x.id===doc.id); if(i>=0) items[i]=doc; else items.push(doc); return items; });
  return doc;
}
export async function deleteMove(mk, id){ await mutateList('moves/'+mk, items=>items.filter(x=>x.id!==id)); }
function kindLabel(k){ return k==='income'?'Income received':k==='refund'?'Refund':k==='adjust'?'Adjustment':'Transfer'; }

// ---------- matching ----------
const digits=s=>String(s||'').replace(/\D/g,'');
/** Bank account for an alert: by masked account number, by debit-card digits, else the owner's only bank account, else the only one. */
export function matchBank(accounts, {mask, last4, owner}){
  const banks=accounts.filter(a=>a.type==='bank' && a.active!==false);
  if(!banks.length) return null;
  if(mask){ const d=digits(mask); const hit=banks.find(a=>a.mask && (digits(a.mask)===d || (d.length>=6 && digits(a.mask).endsWith(d.slice(-3)) && digits(a.mask).startsWith(d.slice(0,3))))); if(hit) return hit; }
  if(last4){ const hit=banks.find(a=>String(a.last4||'')===String(last4)); if(hit) return hit; }
  if(owner){ const mine=banks.filter(a=>String(a.owner||'').toLowerCase()===String(owner).toLowerCase()); if(mine.length===1) return mine[0]; }
  return banks.length===1 ? banks[0] : null;
}
export function matchCardAcc(accounts, {last4, owner}){
  const cards=accounts.filter(a=>a.type==='card' && a.active!==false);
  if(!cards.length) return null;
  if(last4){ const c=cards.find(a=>String(a.last4||'')===String(last4)); if(c) return c; }
  if(owner){ const mine=cards.filter(a=>String(a.owner||'').toLowerCase()===String(owner).toLowerCase()); if(mine.length===1) return mine[0]; }
  return cards.length===1 ? cards[0] : null;
}
/** The owner's account of a given type (cash, bank, savings, card); creates a cash account when asked and none exists. */
export async function accountOfType(settings, accounts, type, owner, {create=false, currency}={}){
  const own=a=>!owner || String(a.owner||'').toLowerCase()===String(owner).toLowerCase();
  const pool = type==='savings' ? accounts.filter(a=>a.active!==false && (a.type==='savings' || (bucketOf(a)==='saved' && ['cash','bank'].includes(a.type))))
             : type==='cash' ? accounts.filter(a=>a.active!==false && a.type==='cash' && bucketOf(a)==='spending')
             : accounts.filter(a=>a.active!==false && a.type===type);
  const mine=pool.filter(own); if(mine.length) return mine.sort((a,b)=>(a.type==='savings'?0:1)-(b.type==='savings'?0:1))[0];
  // nothing of their own: a joint one, else the only one, else (for savings) the first
  const joint=pool.filter(a=>!a.owner || String(a.owner).toLowerCase()==='joint'); if(joint.length) return joint[0];
  const any=pool; if(any.length===1 && !owner) return any[0];
  if(any.length && type==='savings') return any[0];
  if(create && type==='cash'){
    // the baseline sits one tick before creation so a booking saved in the same millisecond still counts
    const now=Date.now(); const doc={ id:newId(), name: owner? `Cash in hand (${owner})` : 'Cash in hand', type:'cash', owner:owner||'Joint', amount:0, currency:currency||settings.base, confirmed:{amount:0, date:new Date(now).toISOString().slice(0,10), ts:now-1}, active:true, ts:now };
    await mutateList('accounts', items=>items.concat([doc]));
    accounts.push(doc);   // the caller's list stays current, so a second item in the same note reuses this account
    return doc;
  }
  return null;
}
/** Is this merchant one of the "cash out" routes (ATM, Careem transfer, exchange office)? */
export function isCashOut(settings, merchant){
  const rules=(settings.cashRules&&settings.cashRules.length? settings.cashRules : ['ATM','Cash Withdrawal','Careem Deliveries']).map(s=>String(s).toLowerCase()).filter(Boolean);
  const m=String(merchant||'').toLowerCase(); return rules.some(r=>m.includes(r));
}

// ---------- balances ----------
/** Record what the bank says an account holds now (its actual balance, or for a card the debt), in the account's currency. */
export async function confirmBalance(settings, id, actual, today, extra={}){
  // The baseline (confirmed) only moves forward when the new reading agrees with what we expected;
  // otherwise it stays, so the gap stays visible until it is explained or accepted.
  const amt=Math.max(0,Math.round(Number(actual)*100)/100);
  const before=await getAccounts(); const acc=before.find(a=>a.id===id); if(!acc) return null;
  let agree=true;
  // an account with no baseline yet takes this reading as its baseline; otherwise the reading must agree with what is logged
  if(acc.confirmed){ const rec=await reconcile(settings, before.map(a=>a.id===id? {...a, amount:amt} : a), today); const r=rec[id]; agree = !r || r.gap===0; }
  let updated=null;
  const items=await mutateList('accounts', items=>items.map(a=>{ if(a.id!==id) return a; updated={...a, ...extra, amount:amt, confirmed: agree? {amount:amt, date:today, ts:Date.now()} : a.confirmed, updatedAt:today}; return updated; }));
  await recordSnapshot(settings, items, today);
  return {account:updated, accounts:items, agree};
}
/**
 * Run a write that touches `ids` and keep those accounts' balances in step with it:
 * an account that agreed with the log before the write is moved to the new expected figure
 * (cash drops when you spend cash, card debt drops when a payment is booked); a later reading confirms or raises a gap.
 */
export async function withSync(settings, today, ids, fn){
  ids=(ids||[]).filter(Boolean);
  const pre = ids.length? await reconcile(settings, await getAccounts(), today) : {};
  const result = await fn();
  if(ids.length){
    const post=await reconcile(settings, await getAccounts(), today);
    // any change in the expected figure moves the balance, even one too small for the gap tolerance (a $1 coffee still leaves the pocket)
    const upd=ids.filter(id=>pre[id] && pre[id].gap===0 && post[id] && Math.abs(post[id].expected-post[id].actual)>=0.005);
    if(upd.length){
      const now=Date.now();
      // move the balance only; the baseline (last real reading) stays where it is, so later edits of these bookings still count
      const items=await mutateList('accounts', items=>items.map(a=>{ if(!upd.includes(a.id)) return a; const v=Math.round(post[a.id].expected*100)/100; const extra = a.type==='card' && Number(a.limit)>0 ? {available: Math.max(0, Math.round((Number(a.limit)-v)*100)/100)} : {}; return {...a, ...extra, amount:v, updatedAt:today}; }));
      await recordSnapshot(settings, items, today);
    }
  }
  return result;
}
/** After a gap has been explained, move the baseline to the current actual figure. */
export async function advanceBaseline(id, today){
  return mutateList('accounts', items=>items.map(a=> a.id===id ? {...a, confirmed:{amount:Number(a.amount)||0, date:today, ts:Date.now()}} : a));
}
/** Apply an available-balance reading from an alert: bank → balance, card → debt = limit − available. */
export async function applyReading(settings, acc, available, availableCurrency, today){
  if(!acc) return null;
  if(availableCurrency && acc.currency && availableCurrency!==acc.currency) return null;
  if(acc.type==='card'){ const limit=Number(acc.limit)||0; if(!(limit>0)) return null; const avail=Math.max(0,Math.min(limit,Number(available)||0)); return confirmBalance(settings, acc.id, limit-avail, today, {available:avail}); }
  return confirmBalance(settings, acc.id, Number(available)||0, today);
}

/** Convert a USD figure into an account's currency. */
const inCur=(settings, usd, cur)=>usd*rate(settings, cur||'USD');

/**
 * Expected balance of each flow account = last confirmed reading ± everything logged against it since.
 * Returns {[id]: {expected, actual, gap, since, moves, expenses}} in the account's currency.
 */
export async function reconcile(settings, accounts, today, preloaded=null){
  const flow=accounts.filter(a=>a.active!==false && FLOW_TYPES.includes(a.type));
  if(!flow.length) return {};
  // scan every month back to the oldest baseline (at least six, at most 24, plus next month for forward-dated entries);
  // per account only what happened after its own baseline counts
  const cm=today.slice(0,7); let earliest=cm;
  for(const a of flow){ const d=a.confirmed? String(a.confirmed.date||'') : (a.ts? new Date(a.ts).toISOString().slice(0,10) : ''); const mk=d.slice(0,7); if(/^\d{4}-\d{2}$/.test(mk) && mk<earliest) earliest=mk; }
  const keys=[shiftMonth(cm,1)]; for(let i=0;i<24;i++){ const k=shiftMonth(cm,-i); if(i>=6 && k<earliest) break; keys.push(k); }
  const pm=preloaded&&preloaded.months||{}, pv=preloaded&&preloaded.moves||{};
  const [months, moves]=await Promise.all([Promise.all(keys.map(k=>pm[k]? pm[k] : getMonth(k))), Promise.all(keys.map(k=>pv[k]? pv[k] : getMoves(k)))]);
  const expenses=months.flat(), mv=moves.flat();
  const out={};
  for(const a of flow){
    const liab=a.type==='card';
    const since=a.confirmed? a.confirmed.ts : (a.ts||null); const base=a.confirmed? a.confirmed.amount : Number(a.amount)||0;
    let exp=base, n=0, flowAbs=0;
    // a booking in the account's own currency counts at face value; only cross-currency ones go through today's rate
    const val=x=> x.currency===a.currency ? Number(x.amount)||0 : inCur(settings,x.usd,a.currency);
    for(const e of expenses){ if(e.from!==a.id || (since && e.ts<=since)) continue; const v=val(e); exp+= liab? v : -v; n++; flowAbs+=Math.abs(v); }
    for(const m of mv){ if(since && m.ts<=since) continue; if(m.toAcc!==a.id && m.fromAcc!==a.id) continue; const v=val(m);
      if(m.toAcc===a.id){ exp+= liab? -v : v; n++; flowAbs+=Math.abs(v); } if(m.fromAcc===a.id){ exp+= liab? v : -v; n++; flowAbs+=Math.abs(v); } }
    const actual=Number(a.amount)||0; let gap=Math.round((actual-exp)*100)/100;
    const tol = 1 + 0.01*flowAbs;   // exchange-rate rounding on converted movements is not a real gap
    if(Math.abs(gap)<=tol) gap=0;
    out[a.id]={expected:Math.round(exp*100)/100, actual, gap, since: a.confirmed? a.confirmed.date : null, confirmed: !!a.confirmed, pending:n};
  }
  return out;
}

// ---------- credit-card cycle: statement amount due on the pay day, and charges since the statement ----------
function nextDay(today, day){ const [y,m,d]=today.split('-').map(Number); const mk=(yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`; const dd=Math.min(day,28); if(d<=dd) return `${mk(y,m)}-${String(dd).padStart(2,'0')}`; const n=new Date(Date.UTC(y,m,1)); return `${mk(n.getUTCFullYear(),n.getUTCMonth()+1)}-${String(dd).padStart(2,'0')}`; }
export function lastDay(today, day){ const [y,m,d]=today.split('-').map(Number); const mk=(yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`; const dd=Math.min(day,28); if(d>=dd) return `${mk(y,m)}-${String(dd).padStart(2,'0')}`; const n=new Date(Date.UTC(y,m-2,1)); return `${mk(n.getUTCFullYear(),n.getUTCMonth()+1)}-${String(dd).padStart(2,'0')}`; }
/**
 * Housekeeping on every load: on the statement day freeze the card's debt as the next amount due (unless the user typed
 * one for this cycle), and give any flow account that still has no baseline one at its current balance.
 */
export async function rollStatements(settings, today){
  const now=Date.now();
  // what an account needs, computed from the copy at hand; applied inside the etag-checked write so nothing newer is overwritten
  const patchFor=a=>{
    const p={};
    if(FLOW_TYPES.includes(a.type) && !a.confirmed) p.confirmed={amount:Number(a.amount)||0, date:today, ts:now};
    if(a.type==='card' && a.statementDay){ const sd=lastDay(today, Number(a.statementDay)); if(!(a.statementSnap && a.statementSnap.date===sd)){ p.statementSnap={date:sd, amount:Number(a.amount)||0}; p.due=Number(a.amount)||0; p.dueSetBy='statement'; } }
    return Object.keys(p).length? p : null;
  };
  const accounts=await getAccounts();
  if(!accounts.some(patchFor)) return accounts;
  return mutateList('accounts', items=>items.map(a=>{ const p=patchFor(a); return p? {...a, ...p} : a; }));
}
/** A payment landed on the card: reduce what is due (a negative amount puts a deleted payment back). */
export async function applyCardPayment(cardId, amountInCardCur){
  return mutateList('accounts', items=>items.map(a=>{ if(a.id!==cardId) return a;
    const due=Math.max(0, Math.round(((Number(a.due)||0)-amountInCardCur)*100)/100);
    const lastPayment = amountInCardCur>0 ? {amount:amountInCardCur, ts:Date.now()} : (a.lastPayment && Math.abs((a.lastPayment.amount||0)+amountInCardCur)<0.01 ? null : a.lastPayment||null);
    return {...a, due, lastPayment}; }));
}
/**
 * Fold duplicate auto-created "Cash in hand" accounts (same owner, pot and currency) into the oldest one: every expense
 * and movement that pointed at a duplicate is re-pointed, balances are added up and the survivor gets a fresh baseline.
 * Returns the number of accounts merged away, or 0.
 */
export async function mergeDuplicateCash(settings, today){
  const accounts=await getAccounts();
  const auto=a=>a.type==='cash' && a.active!==false && /^cash in hand(\s*\(.*\))?$/i.test(String(a.name||'').trim());
  const groups={};
  for(const a of accounts){ if(!auto(a)) continue; const k=[String(a.owner||'joint').toLowerCase(), bucketOf(a), a.currency||settings.base].join('|'); (groups[k]=groups[k]||[]).push(a); }
  const remap={};
  for(const g of Object.values(groups)){ if(g.length<2) continue; g.sort((a,b)=>(a.ts||0)-(b.ts||0)); for(const d of g.slice(1)) remap[d.id]=g[0].id; }
  const gone=Object.keys(remap); if(!gone.length) return 0;
  for(const mk of await listKeys('months/')){ if((await getMonth(mk)).some(e=>remap[e.from])) await mutateList('months/'+mk, items=>items.map(e=> remap[e.from]? {...e, from:remap[e.from]} : e)); }
  for(const mk of await listKeys('moves/')){ if((await getMoves(mk)).some(m=>remap[m.fromAcc]||remap[m.toAcc])) await mutateList('moves/'+mk, items=>items.map(m=>{ const f=remap[m.fromAcc]||m.fromAcc, t=remap[m.toAcc]||m.toAcc; return (f!==m.fromAcc||t!==m.toAcc)? {...m, fromAcc:f, toAcc:t} : m; })); }
  const now=Date.now();
  const items=await mutateList('accounts', items=>{
    const sums={}; for(const a of items){ if(remap[a.id]) sums[remap[a.id]]=(sums[remap[a.id]]||0)+(Number(a.amount)||0); }
    return items.filter(a=>!remap[a.id]).map(a=>{ if(sums[a.id]==null) return a; const amount=Math.round(((Number(a.amount)||0)+sums[a.id])*100)/100; return {...a, amount, confirmed:{amount, date:today, ts:now}, updatedAt:today}; });
  });
  await recordSnapshot(settings, items, today);
  return gone.length;
}
/** Figures for the Wealth tab: due on the next pay day, and charges since the statement. */
export function cardCycle(card, today){
  const payDay=Number(card.payDay)||0; const due=Number(card.due)||0; const debt=Number(card.amount)||0;
  let next = payDay? nextDay(today, payDay) : null;
  // a payment already made for this cycle moves the date to next month
  if(next && card.lastPayment && card.lastPayment.ts){ const paidOn=new Date(card.lastPayment.ts).toISOString().slice(0,10); const near=Math.abs((new Date(paidOn)-new Date(next))/86400000)<=5; if(near && due<=0.5){ const [y,m]=next.split('-').map(Number); const n=new Date(Date.UTC(y,m,1)); next=`${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(payDay,28)).padStart(2,'0')}`; } }
  return { payDay, nextPayDate: next, due, sinceStatement: Math.max(0, Math.round((debt-due)*100)/100), statementDate: card.statementSnap? card.statementSnap.date : null };
}

/** Month check: income received vs planned, spent, expected change vs actual change in flow accounts. */
export async function monthCheck(settings, mk, accounts, networth, today){
  const [expenses, moves, income]=await Promise.all([getMonth(mk), getMoves(mk), getIncome()]);
  const spentUSD=expenses.reduce((t,e)=>t+e.usd,0);
  const incomeUSD=moves.filter(m=>m.kind==='income').reduce((t,m)=>t+m.usd,0);
  const refundsUSD=moves.filter(m=>m.kind==='refund').reduce((t,m)=>t+m.usd,0);
  const adjustUSD=moves.filter(m=>m.kind==='adjust').reduce((t,m)=>t+(m.toAcc? m.usd : -m.usd),0);
  const byId=Object.fromEntries(accounts.map(a=>[a.id,a])); const bk=id=>byId[id]? bucketOf(byId[id]) : null;
  const savedUSD=moves.filter(m=>m.kind==='transfer').reduce((t,m)=>t+((bk(m.toAcc)==='saved'&&bk(m.fromAcc)!=='saved')? m.usd : (bk(m.fromAcc)==='saved'&&bk(m.toAcc)!=='saved')? -m.usd : 0),0);
  const planned=income.filter(i=>i.active!==false).map(i=>({id:i.id, name:i.name, by:i.by, usd: toUSD(settings,i.amount,i.currency)*(i.period==='yearly'?1/12:1), received: moves.some(m=>m.kind==='income' && m.incomeId===i.id)}));
  const flowNow=accounts.filter(a=>a.active!==false && FLOW_TYPES.includes(a.type)).reduce((t,a)=>t+(a.type==='card'? -toUSD(settings,a.amount,a.currency) : toUSD(settings,a.amount,a.currency)),0);
  const pts=(networth||[]).filter(p=>p.flow!=null); const startPt=[...pts].reverse().find(p=>p.date<mk+'-01') || pts.find(p=>p.date>=mk+'-01'); const endPt=[...pts].reverse().find(p=>p.date<=mk+'-31');
  const actualDelta = (startPt && endPt && startPt!==endPt)? (endPt.flow-startPt.flow) : null;
  return { month:mk, spentUSD, incomeUSD, refundsUSD, adjustUSD, savedUSD, planned, plannedUSD: planned.reduce((t,p)=>t+p.usd,0), expectedDelta: incomeUSD+refundsUSD-spentUSD, actualDelta, flowNow, startDate: startPt? startPt.date : null };
}
