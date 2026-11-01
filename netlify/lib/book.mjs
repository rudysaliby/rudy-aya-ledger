// Booking parsed notes: expenses leave the account they were paid from, transfers move money between accounts.
// Shared by the app (/api/expense), Siri (/siri) and Apple Pay (/pay) so every route links to the same accounts.
import { getAccounts, saveExpenses, toUSD, rate } from "./ledger.mjs";
import { saveMove, accountOfType, withSync, applyCardPayment } from "./flow.mjs";

const AT=['cash','bank','savings','card'];

/** Resolve "cash"/"bank"/"card"/"savings" for a member into an account id (creating a cash account on demand). */
export async function resolveAcc(settings, accounts, type, owner){
  if(!type) return null;
  const a=await accountOfType(settings, accounts, type, owner, {create:true, currency: type==='cash'?'USD':settings.base});
  return a? a.id : null;
}

/**
 * Book the items a note parsed into: transfers become movements, expenses are saved against the account that paid
 * (said in the note, else the member's default, else cash in hand). Returns {saved, moves, draft}; draft is set when the
 * only item has no amount, so the app can ask for it.
 */
export async function bookItems(settings, items, {by, source, today, accounts}={}){
  accounts = accounts || await getAccounts();
  const transfers=items.filter(i=>i.kind==='transfer' && i.amount>0); const blank=items.filter(i=>i.kind==='transfer' && !(i.amount>0)); items=items.filter(i=>i.kind!=='transfer');
  // "moved money to cash" with no amount: nothing to book, ask for the figure
  if(!transfers.length && !items.length && blank.length) return {saved:[], moves:[], draft:{...blank[0], by: blank[0].by||by}};
  const moves=[];
  for(const t of transfers){
    const owner=t.by||by; const fromAcc=await resolveAcc(settings, accounts, t.from||'bank', owner); const toAcc=await resolveAcc(settings, accounts, t.to||'cash', owner);
    moves.push(await withSync(settings, today, [fromAcc,toAcc], ()=>saveMove(settings, {kind:'transfer', fromAcc, toAcc, amount:t.amount, currency:t.currency, desc:t.description||'Transfer', date:t.date}, {by:owner, source})));
    const card=accounts.find(a=>a.id===toAcc && a.type==='card'); if(card){ try{ await applyCardPayment(card.id, toUSD(settings,t.amount,t.currency)*rate(settings,card.currency)); }catch(e){} }
  }
  if(!items.length) return {saved:[], moves, draft:null};
  if(items.length===1 && !(items[0].amount>0)) return {saved:[], moves, draft:{...items[0], by: items[0].by||by}};
  for(const it of items){
    if(it.from && accounts.some(a=>a.id===it.from)) continue;          // already an account id (app picked it)
    if(it.from==='none'){ it.from=null; continue; }                      // explicitly not tracked
    const owner=it.by||by;
    const want=it.paidWith || (AT.includes(it.from)? it.from : null) || (settings.defaultPaid||{})[owner] || 'cash';
    it.from=await resolveAcc(settings, accounts, want, owner);
  }
  const saved=await withSync(settings, today, items.map(i=>i.from), ()=>saveExpenses(settings, items, {by, source}));
  return {saved, moves, draft:null};
}
