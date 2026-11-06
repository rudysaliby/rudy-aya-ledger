// Fixed costs from the Plan (rent, subscriptions, salaries, bills) are often also logged as expenses — by hand, or by
// a bank alert when the card is charged. Those payments must not be counted twice: once as the fixed cost and again
// as day-to-day spending. This recognises them. The same function lives in public/app.js for the app; keep them equal.

/**
 * Which logged expenses are payments of a fixed cost. A choice made by hand (recSet 'user') always wins. Otherwise,
 * for each fixed cost and month, the first expense whose description names it (as a whole word) and whose amount is
 * close to it — within 30%, within 50% when the whole name matches, or the full yearly amount — is taken.
 * `recs`: [{id, name, period, active, monthlyUSD}]. Returns a Map of expense id → fixed cost id.
 */
export function linkFixed(items, recs){
  const STOP=new Set(['the','and','for','bill','bills','fee','fees','monthly','yearly','payment','subscription','plan','with','from','per','month','year']);
  const norm=s=>' '+String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const cands=recs.filter(r=>r.active!==false && r.monthlyUSD>0).map(r=>{ const n=norm(r.name); return {r, n, tokens:n.trim().split(' ').filter(t=>t.length>=3 && !STOP.has(t))}; }).filter(c=>c.n.trim());
  const links=new Map(), taken=new Set(); const near=(a,b,tol)=>Math.abs(a-b)<=Math.max(5,tol*b);
  for(const e of items){ if(e.recSet==='user' && e.recId && recs.some(r=>r.id===e.recId)){ links.set(e.id,e.recId); taken.add(e.recId+'|'+e.month); } }
  const rest=items.filter(e=>e.recSet!=='user').sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.ts||0)-(b.ts||0));
  for(const e of rest){ const d=norm(e.desc)+norm(e.note); let best=null;
    for(const c of cands){ if(taken.has(c.r.id+'|'+e.month)) continue;
      const whole=d.includes(c.n); if(!whole && !c.tokens.some(t=>d.includes(' '+t+' '))) continue;
      const m=c.r.monthlyUSD, full=c.r.period==='yearly'? m*12 : m;
      if(!(near(e.usd,m,whole?0.5:0.3) || (c.r.period==='yearly' && near(e.usd,full,0.3)))) continue;
      const score=(whole?2:1)+((near(e.usd,m,0.1)||near(e.usd,full,0.1))?1:0); if(!best||score>best.score) best={id:c.r.id,score}; }
    if(best){ links.set(e.id,best.id); taken.add(best.id+'|'+e.month); } }
  return links;
}

/** Split a month's expenses into day-to-day items and what was paid per fixed cost ({recId: usd}). */
export function splitFixed(items, recs){
  const links=linkFixed(items, recs); const paidBy={};
  for(const e of items){ const id=links.get(e.id); if(id) paidBy[id]=(paidBy[id]||0)+e.usd; }
  return {links, dayToDay: items.filter(e=>!links.has(e.id)), paidBy};
}
