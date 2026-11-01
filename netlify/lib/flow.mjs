// Money flow: movements between accounts, account matching for bank alerts, and expected-vs-actual balances.
import { HttpError, readJSON, writeJSON, mutateList, getAccounts, getMonth, getIncome, recordSnapshot, toUSD, rate, newId, shiftMonth, memberName, LIABILITY_TYPES } from "./ledger.mjs";

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
  const mine=accounts.filter(a=>a.type===type && a.active!==false && (!owner || String(a.owner||'').toLowerCase()===String(owner).toLowerCase()));
  if(mine.length) return mine[0];
  const any=accounts.filter(a=>a.type===type && a.active!==false);
  if(any.length===1 && !owner) return any[0];
  if(create && type==='cash'){
    const now=Date.now(); const doc={ id:newId(), name: owner? `Cash (${owner})` : 'Cash', type:'cash', owner:owner||'Joint', amount:0, currency:currency||settings.base, confirmed:{amount:0, date:new Date(now).toISOString().slice(0,10), ts:now}, active:true, ts:now };
    await mutateList('accounts', items=>items.concat([doc])); return doc;
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
  { const rec=await reconcile(settings, before.map(a=>a.id===id? {...a, amount:amt} : a), today); const r=rec[id]; agree = !r || r.gap===0; }
  let updated=null;
  const items=await mutateList('accounts', items=>items.map(a=>{ if(a.id!==id) return a; updated={...a, ...extra, amount:amt, confirmed: agree? {amount:amt, date:today, ts:Date.now()} : a.confirmed, updatedAt:today}; return updated; }));
  await recordSnapshot(settings, items, today);
  return {account:updated, accounts:items, agree};
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
  // scan the last six months; per account only what happened after its baseline counts
  const cm=today.slice(0,7); const keys=[]; for(let i=0;i<6;i++) keys.push(shiftMonth(cm,-i));
  let expenses, mv;
  if(preloaded && preloaded.months && preloaded.moves){ expenses=keys.flatMap(k=>preloaded.months[k]||[]); mv=keys.flatMap(k=>preloaded.moves[k]||[]); }
  else { const [months, moves]=await Promise.all([Promise.all(keys.map(getMonth)), Promise.all(keys.map(getMoves))]); expenses=months.flat(); mv=moves.flat(); }
  const out={};
  for(const a of flow){
    const liab=a.type==='card';
    const since=a.confirmed? a.confirmed.ts : (a.ts||null); const base=a.confirmed? a.confirmed.amount : Number(a.amount)||0;
    let exp=base, n=0, flowAbs=0;
    for(const e of expenses){ if(e.from!==a.id || (since && e.ts<=since)) continue; const v=inCur(settings,e.usd,a.currency); exp+= liab? v : -v; n++; flowAbs+=Math.abs(v); }
    for(const m of mv){ if(since && m.ts<=since) continue; const v=inCur(settings,m.usd,a.currency);
      if(m.toAcc===a.id){ exp+= liab? -v : v; n++; flowAbs+=Math.abs(v); } if(m.fromAcc===a.id){ exp+= liab? v : -v; n++; flowAbs+=Math.abs(v); } }
    const actual=Number(a.amount)||0; let gap=Math.round((actual-exp)*100)/100;
    const tol = 1 + 0.01*flowAbs;   // exchange-rate rounding on converted movements is not a real gap
    if(Math.abs(gap)<=tol) gap=0;
    out[a.id]={expected:Math.round(exp*100)/100, actual, gap, since: a.confirmed? a.confirmed.date : null, confirmed: !!a.confirmed, pending:n};
  }
  return out;
}

/** Month check: income received vs planned, spent, expected change vs actual change in flow accounts. */
export async function monthCheck(settings, mk, accounts, networth, today){
  const [expenses, moves, income]=await Promise.all([getMonth(mk), getMoves(mk), getIncome()]);
  const spentUSD=expenses.reduce((t,e)=>t+e.usd,0);
  const incomeUSD=moves.filter(m=>m.kind==='income').reduce((t,m)=>t+m.usd,0);
  const refundsUSD=moves.filter(m=>m.kind==='refund').reduce((t,m)=>t+m.usd,0);
  const adjustUSD=moves.filter(m=>m.kind==='adjust').reduce((t,m)=>t+(m.toAcc? m.usd : -m.usd),0);
  const planned=income.filter(i=>i.active!==false).map(i=>({id:i.id, name:i.name, by:i.by, usd: toUSD(settings,i.amount,i.currency)*(i.period==='yearly'?1/12:1), received: moves.some(m=>m.kind==='income' && m.incomeId===i.id)}));
  const flowNow=accounts.filter(a=>a.active!==false && FLOW_TYPES.includes(a.type)).reduce((t,a)=>t+(a.type==='card'? -toUSD(settings,a.amount,a.currency) : toUSD(settings,a.amount,a.currency)),0);
  const pts=(networth||[]).filter(p=>p.flow!=null); const startPt=[...pts].reverse().find(p=>p.date<mk+'-01') || pts.find(p=>p.date>=mk+'-01'); const endPt=[...pts].reverse().find(p=>p.date<=mk+'-31');
  const actualDelta = (startPt && endPt && startPt!==endPt)? (endPt.flow-startPt.flow) : null;
  return { month:mk, spentUSD, incomeUSD, refundsUSD, adjustUSD, planned, plannedUSD: planned.reduce((t,p)=>t+p.usd,0), expectedDelta: incomeUSD+refundsUSD-spentUSD, actualDelta, flowNow, startDate: startPt? startPt.date : null };
}
