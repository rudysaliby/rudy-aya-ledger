// Rudy & Aya Ledger — helpers, state, rendering (sheets.js continues in the same scope)
'use strict';
const TAGS = ['Groceries','Dining','Coffee','Transport','Fuel','Kids','School','Health','Pharmacy','Home','Utilities','Shopping','Clothes','Beauty','Entertainment','Travel','Gifts','Pets','Work','Fees','Other'];
const TAG_ICON = {Groceries:'🛒',Dining:'🍽️',Coffee:'☕',Transport:'🚕',Fuel:'⛽',Kids:'🧸',School:'🎒',Health:'🩺',Pharmacy:'💊',Home:'🏠',Utilities:'💡',Shopping:'🛍️',Clothes:'👕',Beauty:'💅',Entertainment:'🎬',Travel:'✈️',Gifts:'🎁',Pets:'🐾',Work:'💼',Fees:'🏦',Other:'•'};
const KINDS = [['subscription','Subscriptions'],['salary','Staff salaries'],['housing','Housing'],['utility','Utilities'],['insurance','Insurance'],['other','Other']];
const CURRENCIES = ['USD','LBP','EUR','AED'];
const DEFAULT_SETTINGS = { members:['Rudy','Aya'], people:['Noah'], base:'USD', rates:{USD:1, LBP:89500, EUR:0.92, AED:3.6725}, budget:null, timezone:'Asia/Beirut', goldPrice:null };
const ACC_TYPES=[['cash','Cash in hand','💵'],['bank','Bank account','🏦'],['savings','Savings','🐷'],['investment','Investments','📈'],['gold','Gold','🪙'],['loan','Loan','📄'],['card','Credit card','💳']];
const LIAB=['loan','card'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PCOL = ['var(--p1)','var(--p2)','var(--p3)','var(--p4)'];
const CAT_COLORS = ['var(--p1)','var(--p2)','var(--p3)','var(--p4)','var(--p5)','var(--p6)','var(--p7)','var(--p8)'];   // categories, in fixed order of household rank
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const S = {
  key: ls('key')||'', who: ls('who')||null,
  settings:{...DEFAULT_SETTINGS, rates:{...DEFAULT_SETTINGS.rates}},
  months:{}, moves:{}, monthKeys:[], recurring:[], income:[], accounts:[], networth:[], recon:{}, check:null, loaded:false, loading:false, selectMode:false, selected:new Set(),
  tab:'add', hMonth: monthKey(new Date()), range:[monthKey(new Date())], view: ls('insView')||'',
  hFilter:{by:null, tag:null}, monthLoading:{}, toastTimer:null, aiCtl:null, aiDone:false, pollTimer:null,
};

// ---------- helpers ----------
function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ v==null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch(e){} }
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pad(n){ return String(n).padStart(2,'0'); }
function dateKey(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function monthKey(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1); }
function todayKey(){ return dateKey(new Date()); }
function monthLabel(mk){ const [y,m]=mk.split('-').map(Number); return MONTHS[m-1]+' '+y; }
function monthShort(mk){ const [y,m]=mk.split('-').map(Number); return MONTHS[m-1].slice(0,3)+(y!==new Date().getFullYear()?' '+String(y).slice(2):''); }
function shiftMonth(mk,n){ const [y,m]=mk.split('-').map(Number); return monthKey(new Date(y,m-1+n,1)); }
function daysInMonth(mk){ const [y,m]=mk.split('-').map(Number); return new Date(y,m,0).getDate(); }
function dayLabel(dk){ const [y,m,d]=dk.split('-').map(Number); const dt=new Date(y,m-1,d); if(dk===todayKey()) return 'Today'; const yd=new Date(); yd.setDate(yd.getDate()-1); if(dk===dateKey(yd)) return 'Yesterday'; return dt.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}); }
function rate(c){ const r=S.settings.rates||{}; return Number(r[c])>0 ? Number(r[c]) : 1; }
function fromUSD(usd,cur){ return usd*rate(cur||S.settings.base); }
function sym(c){ return c==='USD'?'$':c==='LBP'?'L.L. ':c==='EUR'?'€':c==='AED'?'AED ':c+' '; }
function fmtAmt(amount,cur){ cur=cur||S.settings.base; const dec=(cur==='LBP')?0:(Math.abs(amount)%1<0.005?0:2); const n=Number(amount||0); return (n<0?'−':'')+sym(cur)+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
function fmtBase(usd){ return fmtAmt(fromUSD(usd,S.settings.base), S.settings.base); }
function fmtShort(usd){ const v=fromUSD(usd,S.settings.base); const c=S.settings.base; if(c==='LBP'){ if(v>=1e6) return 'L.L. '+(v/1e6).toFixed(1).replace(/\.0$/,'')+'M'; if(v>=1e3) return 'L.L. '+Math.round(v/1e3)+'k'; return 'L.L. '+Math.round(v); } if(v>=1e3) return sym(c)+(v/1e3).toFixed(v>=1e4?0:1).replace(/\.0$/,'')+'k'; return sym(c)+Math.round(v); }
function memberIdx(name){ return (S.settings.members||[]).findIndex(m=>m.toLowerCase()===String(name||'').toLowerCase()); }
function memberColor(name){ const i=memberIdx(name); return i>=0 ? PCOL[i%PCOL.length] : 'var(--faint)'; }
function initial(name){ return String(name||'?').trim().charAt(0).toUpperCase()||'?'; }
function recMonthlyUSD(r){ const u=Number(r.amount||0)/rate(r.currency||'USD'); return r.period==='yearly'? u/12 : u; }
/** How much of a fixed cost or income counts for one person: theirs in full, nobody's split evenly, someone else's not at all. Everyone: all of it. */
function shareOf(r, who){ if(!who) return 1; const by=String(r.by||'').trim(); if(!by) return 1/Math.max(1,(S.settings.members||[]).length); return by.toLowerCase()===who.toLowerCase()? 1 : 0; }
function isBy(e, who){ return String(e.by||'').trim().toLowerCase()===String(who).toLowerCase(); }
function incomeUSD(who){ return S.income.filter(i=>i.active!==false).reduce((a,i)=>a+recMonthlyUSD(i)*shareOf(i,who),0); }
function accountUSD(a){ if(a.type==='gold'){ const g=Number(a.grams)||0, pr=Number(S.settings.goldPrice)||0; if(g>0&&pr>0) return g*pr; } return Number(a.amount||0)/rate(a.currency||'USD'); }
function owners(){ return [...(S.settings.members||[]), ...(S.settings.people||[]), 'Joint']; }
function ownerColor(o){ const i=owners().indexOf(o); return i>=0? PCOL[i%PCOL.length] : 'var(--faint)'; }
function accType(t){ return ACC_TYPES.find(x=>x[0]===t)||ACC_TYPES[1]; }
function bucketOf(a){ if(a.bucket==='saved'||a.bucket==='spending') return a.bucket; return ['savings','investment','gold'].includes(a.type)? 'saved' : 'spending'; }
function typeLabel(a){ const t=accType(a.type); if(a.type==='cash') return bucketOf(a)==='saved'? 'Savings (cash)' : 'Cash in hand'; if(a.type==='bank' && bucketOf(a)==='saved') return 'Savings (bank)'; return t[1]; }
function typeIcon(a){ if(a.type==='cash' && bucketOf(a)==='saved') return '🐷'; return accType(a.type)[2]; }
function accById(id){ return id? S.accounts.find(a=>a.id===id) : null; }
/** One unambiguous line per account for pickers: name, owner (unless the name says it), kind (unless the name says it), balance. */
function accLabel(a){ const n=String(a.name||'').trim(); const owner=a.owner||'Joint'; const tl=typeLabel(a); const parts=[n + (n.toLowerCase().includes(owner.toLowerCase())? '' : ' ('+owner+')')]; if(!n.toLowerCase().includes(tl.toLowerCase().replace(/\s*\(.*\)$/,''))) parts.push(tl); parts.push((LIAB.includes(a.type)? 'owes ' : '')+fmtAmt(a.amount, a.currency)); return parts.join(' · '); }
/** <optgroup>s of the flow accounts, everyday money first, then long-term savings, then credit cards. */
function accOptgroups(flow, sel){ const opt=a=>`<option value="${esc(a.id)}" ${a.id===sel?'selected':''}>${esc(accLabel(a))}</option>`; const ev=flow.filter(a=>bucketOf(a)==='spending'&&a.type!=='card'), sv=flow.filter(a=>bucketOf(a)==='saved'&&a.type!=='card'), cd=flow.filter(a=>a.type==='card'); return (ev.length?`<optgroup label="Everyday money">${ev.map(opt).join('')}</optgroup>`:'')+(sv.length?`<optgroup label="Long-term savings">${sv.map(opt).join('')}</optgroup>`:'')+(cd.length?`<optgroup label="Credit cards">${cd.map(opt).join('')}</optgroup>`:''); }
function flowAccounts(){ return S.accounts.filter(a=>a.active!==false && ['cash','bank','savings','card'].includes(a.type)); }
function srcChip(e){ const a=accById(e.from); if(!a) return ''; const lbl = a.type==='card'? ('card'+(a.last4?' ··'+a.last4:'')) : a.type==='cash'? (bucketOf(a)==='saved'?'savings':'in hand') : a.type==='savings'? 'savings' : 'bank'; return `<span class="src">${accType(a.type)[2]} ${esc(lbl)}</span>`; }
function moveRowHTML(m){ const f=accById(m.fromAcc), t=accById(m.toAcc); const icon = m.kind==='income'?'⬇️':m.kind==='refund'?'↩️':m.kind==='adjust'?'⚖️':'↔️';
  const path = m.kind==='income'? ('→ '+(t?t.name:'?')) : m.kind==='refund'? ('→ '+(t?t.name:'?')) : m.kind==='adjust'? (t? '→ '+t.name : f? f.name+' →' : '') : ((f?f.name:'?')+' → '+(t?t.name:'?'));
  const orig = m.currency!==S.settings.base ? `<small>${esc(fmtAmt(m.amount,m.currency))}</small>` : '';
  return `<li class="tap move" data-move="${esc(m.id)}" data-month="${esc(m.month)}"><span class="tagdot" aria-hidden="true">${icon}</span><div class="main"><div class="desc">${esc(m.desc)}</div><div class="meta">${esc(path)}${m.by?' · '+esc(m.by):''}${m.source==='sms'?' · bank alert':''}</div></div><div class="amt">${esc(fmtBase(m.usd))}${orig}</div></li>`; }
function isStandalone(){ return window.navigator.standalone===true || window.matchMedia('(display-mode: standalone)').matches; }
function niceCeil(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))); const m=v/p; const n = m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10; return n*p; }

// ---------- API ----------
async function api(path, {method='GET', body}={}){
  const url='/api/'+path+(method==='GET'? (path.includes('?')?'&':'?')+'today='+todayKey() : '');
  const res=await fetch(url,{method, headers:{'content-type':'application/json','x-ledger-key':S.key}, body: body? JSON.stringify({...body, today:todayKey()}) : undefined});
  if(res.status===401){ throw {code:'auth', message:'Wrong household key'}; }
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw {code:'http', status:res.status, message:data.error||('Request failed ('+res.status+')')};
  return data;
}
async function load(){
  if(!S.key) return;
  if(S.loading){ S.reloadPending=true; return; }   // a save during a poll: fetch again once it lands, so the older reply cannot hide the new entry
  S.loading=true;
  try{ const d=await api('state'); S.settings={...DEFAULT_SETTINGS,...d.settings, rates:{...DEFAULT_SETTINGS.rates,...(d.settings.rates||{})}}; S.recurring=d.recurring||[]; S.income=d.income||[]; S.accounts=d.accounts||[]; S.networth=d.networth||[]; S.recon=d.recon||{}; S.check=d.check||null; Object.assign(S.months, d.months||{}); Object.assign(S.moves, d.moves||{}); S.monthKeys=d.monthKeys||[]; S.loaded=true; render(); }
  catch(e){ if(e.code==='auth'){ signOut('That key no longer works.'); } else if(!S.loaded){ $('recentList').innerHTML='<li class="empty">'+esc(e.message||'Could not reach the ledger.')+'<br><button class="link" id="retryBtn">Try again</button></li>'; const b=$('retryBtn'); if(b) b.onclick=load; } }
  S.loading=false;
  if(S.reloadPending){ S.reloadPending=false; load(); }
}
function monthItems(mk){ return S.months[mk]||[]; }
async function ensureMonth(mk){ if(S.months[mk] || S.monthLoading[mk] || !S.key) return; S.monthLoading[mk]=true; try{ const d=await api('month?m='+mk); S.months[mk]=d.items||[]; S.moves[mk]=d.moves||[]; }catch(e){ S.months[mk]=[]; S.moves[mk]=[]; } S.monthLoading[mk]=false; render(); }
function allRecent(){ return Object.values(S.months).flat().sort((a,b)=>b.ts-a.ts); }
function signOut(msg){ S.key=''; lsSet('key',null); showWelcome(msg); }

// ---------- welcome ----------
function showWelcome(err){
  $('welcome').classList.remove('hide'); $('wErr').classList.toggle('hide',!err); $('wErr').textContent=err||'';
  $('wKeyField').classList.remove('hide'); $('wWhoField').classList.add('hide'); $('wGo').textContent='Continue';
  setTimeout(()=>$('w-key').focus(),200);
}
$('wGo').onclick=async()=>{
  const btn=$('wGo');
  if(!$('wKeyField').classList.contains('hide')){
    const k=$('w-key').value.trim(); if(!k) return; btn.disabled=true; btn.textContent='Checking…';
    S.key=k; try{ await load(); if(!S.loaded) throw {message: S.key? 'Could not reach the ledger. Check the connection and try again.' : 'That key is not right. It is the HOUSEHOLD_KEY secret on the Cloudflare Worker.'}; lsSet('key',k); $('wErr').classList.add('hide'); $('wKeyField').classList.add('hide'); $('wWhoField').classList.remove('hide'); $('wIntro').textContent='Expenses added from this phone are marked as theirs. Saying "Aya paid…" overrides it.';
      $('wWho').innerHTML=(S.settings.members||[]).map(m=>`<button type="button" class="chip ${m===S.who?'on':''}" data-chip="who" data-val="${esc(m)}" style="padding:12px 20px;font-size:16px"><i class="dot" style="background:${memberColor(m)}"></i>${esc(m)}</button>`).join(''); wireChips($('wWho')); btn.textContent="That's me";
    }catch(e){ S.key=''; $('wErr').textContent=e.message||'Wrong key'; $('wErr').classList.remove('hide'); btn.textContent='Continue'; }
    btn.disabled=false; return;
  }
  const v=chipVal($('wWho'),'who'); if(!v) return; S.who=v; lsSet('who',v); $('welcome').classList.add('hide'); render(); startPolling();
};
$('w-key').addEventListener('keydown',e=>{ if(e.key==='Enter') $('wGo').click(); });

// ---------- rendering ----------
function render(){ _links={}; renderHeader(); if(S.tab==='add') renderAdd(); if(S.tab==='history') renderHistory(); if(S.tab==='plan') renderPlan(); if(S.tab==='wealth') renderWealth(); if(S.tab==='insights') renderInsights(); }
function renderHeader(){ const b=$('whoBtn'); b.textContent=initial(S.who||'?'); b.style.background=S.who? memberColor(S.who):'var(--faint)'; const ms=S.settings.members||[]; $('brandName').textContent = ms.length? ms.join(' & ') : 'Ledger'; }
/** Month-end projection of day-to-day spending; before day 3 there is too little to go on, so the total so far is used. */
function projectedTotal(st){ return st.elapsed>=3 ? st.total/st.elapsed*st.dim : st.total; }
/**
 * Which logged expenses are payments of a fixed cost from the Plan (rent, subscriptions, salaries, bills), so they are
 * counted once — as the fixed cost — and not again as day-to-day. Same function as src/lib/fixed.mjs; keep them equal.
 * A choice made by hand (recSet 'user') always wins. Otherwise, for each fixed cost and month, the first expense whose
 * description names it (as a whole word) and whose amount is close to it — within 30%, within 50% when the whole name
 * matches, or the full yearly amount — is taken; a cost marked `variable` needs only the name. Returns a Map of expense id → fixed cost id.
 */
function linkFixed(items, recs){
  const STOP=new Set(['the','and','for','bill','bills','fee','fees','monthly','yearly','payment','subscription','plan','with','from','per','month','year']);
  const norm=s=>' '+String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const cands=recs.filter(r=>r.active!==false && r.monthlyUSD>0).map(r=>{ const n=norm(r.name); return {r, n, tokens:n.trim().split(' ').filter(t=>t.length>=3 && !STOP.has(t))}; }).filter(c=>c.n.trim());
  const links=new Map(), taken=new Set(); const near=(a,b,tol)=>Math.abs(a-b)<=Math.max(5,tol*b);
  for(const e of items){ if(e.recSet==='user' && e.recId && recs.some(r=>r.id===e.recId)){ links.set(e.id,e.recId); taken.add(e.recId+'|'+e.month); } }
  const rest=items.filter(e=>e.recSet!=='user').sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.ts||0)-(b.ts||0));
  for(const e of rest){ const d=norm(e.desc)+norm(e.note); let best=null;
    for(const c of cands){ if(taken.has(c.r.id+'|'+e.month)) continue;
      const whole=d.includes(c.n); const toks=c.tokens.filter(t=>d.includes(' '+t+' ')).length; if(!whole && !toks) continue;
      const m=c.r.monthlyUSD, full=c.r.period==='yearly'? m*12 : m;
      if(c.r.variable){ if((!whole && toks<c.tokens.length) || e.usd<0.25*m) continue; }   // a bill that varies: its whole name, any amount above a quarter of the typical one
      else if(!(near(e.usd,m,whole?0.5:0.3) || (c.r.period==='yearly' && near(e.usd,full,0.3)))) continue;
      const score=(whole?2:1)+((near(e.usd,m,0.1)||near(e.usd,full,0.1))?1:0); if(!best||score>best.score) best={id:c.r.id,score}; }
    if(best){ links.set(e.id,best.id); taken.add(best.id+'|'+e.month); } }
  return links;
}
const recsForLinks=()=>S.recurring.map(r=>({id:r.id, name:r.name, period:r.period, active:r.active, variable:!!r.variable, monthlyUSD:recMonthlyUSD(r)}));
/** Fixed-cost links for one month's expenses (expense id → fixed cost id). */
let _links={};   // per render: month → links, so list rows do not recompute them
function monthLinks(mk){ return _links[mk] || (_links[mk]=linkFixed(monthItems(mk), recsForLinks())); }
/** The fixed cost a logged expense is a payment of, or null. */
function fixedOf(e){ const id=monthLinks(e.month).get(e.id); return id? recById(id)||null : null; }
const recById=id=>S.recurring.find(r=>r.id===id);
/**
 * Totals for one month; with `who`, only that person's expenses and their share of fixed costs. Payments of fixed
 * costs are left out of day-to-day (`ex`, `total`) and shown in `paidItems`. Fixed costs: a monthly cost paid this
 * month counts at what was paid (household view), the rest at their planned amount, yearly ones at a twelfth.
 */
function monthStats(mk, who){
  const all=monthItems(mk); const links=monthLinks(mk); const mine = who? all.filter(e=>isBy(e,who)) : all;
  const ex=mine.filter(e=>!links.has(e.id)), paidItems=mine.filter(e=>links.has(e.id)); const byTag={}, byPerson={}, byDay={}, byTagBy={}; let total=0;
  for(const e of ex){ total+=e.usd; byTag[e.tag]=(byTag[e.tag]||0)+e.usd; const p=e.by||'Unknown'; byPerson[p]=(byPerson[p]||0)+e.usd; const tb=byTagBy[e.tag]||(byTagBy[e.tag]={}); tb[p]=(tb[p]||0)+e.usd; const d=Number(e.date.slice(8,10)); byDay[d]=(byDay[d]||0)+e.usd; }
  const paidBy={}; for(const e of all){ const id=links.get(e.id); if(id) paidBy[id]=(paidBy[id]||0)+e.usd; }
  const recs=S.recurring.filter(r=>r.active!==false && shareOf(r,who)>0); let fixed=0, paidN=0;
  for(const r of recs){ const planned=recMonthlyUSD(r)*shareOf(r,who); if(paidBy[r.id]!=null){ paidN++; fixed += (who || r.period==='yearly')? planned : paidBy[r.id]; } else fixed+=planned; }
  const dim=daysInMonth(mk); const t=todayKey(); const elapsed = mk===t.slice(0,7)? Number(t.slice(8,10)) : (mk<t.slice(0,7)? dim : 0);
  return {ex,paidItems,paidBy,total,byTag,byPerson,byTagBy,byDay,fixed,fixedN:recs.length,paidN,dim,elapsed,count:ex.length};
}
function renderAdd(){
  const mk=monthKey(new Date()); const st=monthStats(mk); const prev=monthStats(shiftMonth(mk,-1));
  $('heroLabel').textContent = MONTHS[Number(mk.slice(5,7))-1]+' so far';
  $('heroTotal').textContent = fmtBase(st.total);
  let sub=''; const members=S.settings.members||[]; const names=[...new Set([...members, ...Object.keys(st.byPerson)])];
  names.forEach(n=>{ if(st.byPerson[n]!=null||members.includes(n)) sub+=`<span><i class="dot" style="background:${memberColor(n)};box-shadow:0 0 0 2px rgba(255,255,255,.5)"></i>${esc(n)} <b>${fmtShort(st.byPerson[n]||0)}</b></span>`; });
  if(prev.total>0 && st.elapsed>=3){ const pct=Math.round((st.total/st.elapsed - prev.total/prev.dim)/(prev.total/prev.dim)*100); sub+=`<span>${pct>0?'▲':pct<0?'▼':'•'} ${Math.abs(pct)}% vs last month's pace</span>`; }
  if(st.fixed>0) sub+=`<span>Fixed <b>${fmtShort(st.fixed)}</b>${st.paidN? ' · '+st.paidN+' of '+st.fixedN+' paid' : '/mo'}</span>`;
  const inc=incomeUSD(); if(inc>0){ const left=inc-st.total-st.fixed; sub+=`<span>${left>=0?'Left':'Over'} <b>${fmtShort(Math.abs(left))}</b> of ${fmtShort(inc)} income</span>`; }
  $('heroSub').innerHTML = sub || '<span>Day-to-day spending, both of you</span>';
  const list=$('recentList'); if(!S.loaded){ if(S.key) list.innerHTML='<li class="empty">Loading…</li>'; return; }
  const recent=allRecent().slice(0,8);
  if(!recent.length){ list.innerHTML='<li class="empty"><b>Nothing logged yet.</b><br>Say "Hey Siri, add to my expenses", or type something like "45 groceries at Spinneys" above.</li>'; return; }
  list.innerHTML = recent.map(e=>rowHTML(e)).join('');
}
function rowHTML(e, selectable){
  const showDate = e.date!==todayKey();
  const orig = e.currency!==S.settings.base ? `<small>${esc(fmtAmt(e.amount,e.currency))}</small>` : '';
  const sel = selectable && S.selected.has(e.id);
  return `<li class="tap ${sel?'sel':''}" data-id="${esc(e.id)}" data-month="${esc(e.month)}">${selectable? `<span class="tick">${sel?'✓':''}</span>` : `<span class="tagdot" aria-hidden="true">${TAG_ICON[e.tag]||'•'}</span>`}<div class="main"><div class="desc">${esc(e.desc)}</div><div class="meta"><i class="dot" style="background:${memberColor(e.by)};margin-right:4px"></i>${esc(e.by||'?')} · ${esc(e.tag)}${showDate?' · '+esc(dayLabel(e.date)):''}${e.source==='applepay'?' ·  Pay':e.source==='sms'?' · bank alert':(e.note?' · '+esc(e.note):'')}${srcChip(e)}</div>${(()=>{ const r=fixedOf(e); return r? `<div class="meta"><span class="fx" title="Counted as a fixed cost, not day-to-day">✓ fixed cost · ${esc(r.name)}</span></div>` : ''; })()}</div><div class="amt">${esc(fmtBase(e.usd))}${orig}</div></li>`;
}
function renderHistory(){
  const mk=S.hMonth; $('hMonth').textContent=monthLabel(mk); $('hNext').disabled = mk>=monthKey(new Date()); $('hNext').style.opacity=$('hNext').disabled?.4:1;
  ensureMonth(mk);
  let ex=monthItems(mk); const members=S.settings.members||[]; const tagsHere=[...new Set(ex.map(e=>e.tag))].sort();
  let chips=''; members.forEach(m=>{ chips+=`<button class="chip ${S.hFilter.by===m?'on':''}" data-by="${esc(m)}"><i class="dot" style="background:${memberColor(m)}"></i>${esc(m)}</button>`; });
  tagsHere.forEach(t=>{ chips+=`<button class="chip ${S.hFilter.tag===t?'on':''}" data-tag="${esc(t)}">${TAG_ICON[t]||''} ${esc(t)}</button>`; });
  $('hFilters').innerHTML=chips;
  if(S.hFilter.by) ex=ex.filter(e=>e.by===S.hFilter.by); if(S.hFilter.tag) ex=ex.filter(e=>e.tag===S.hFilter.tag);
  ex=[...ex].sort((a,b)=>(b.date>a.date?1:b.date<a.date?-1:b.ts-a.ts));
  const total=ex.reduce((a,e)=>a+e.usd,0); const fixedPart=ex.filter(e=>fixedOf(e)).reduce((a,e)=>a+e.usd,0);   // payments of fixed costs: in this total, but not in Insights' day-to-day
  $('hCount').textContent = ex.length+(ex.length===1?' expense':' expenses'); $('hTotal').innerHTML=esc(fmtBase(total))+(fixedPart? `<div class="muted" style="font-size:11.5px;font-weight:500;text-align:right;line-height:1.2">incl. ${esc(fmtShort(fixedPart))} fixed costs</div>` : '');
  S.visibleIds = ex.map(e=>e.id);
  $('selbar').classList.toggle('hide', !S.selectMode); $('hSelect').classList.toggle('hide', S.selectMode || !ex.length);
  if(S.selectMode){ const n=[...S.selected].filter(id=>S.visibleIds.includes(id)).length; $('selCount').textContent = n+' selected'; $('selDel').disabled=!n; $('selDel').textContent = n? 'Delete '+n : 'Delete'; $('selAll').textContent = n===ex.length && ex.length? 'Clear' : 'Select all'; }
  const list=$('histList');
  if(S.monthLoading[mk]){ list.innerHTML='<li class="empty">Loading…</li>'; return; }
  if(!ex.length && !(S.moves[mk]||[]).length){ list.innerHTML=`<li class="empty">Nothing ${S.hFilter.by||S.hFilter.tag?'matching ':''}in ${esc(monthLabel(mk))}.</li>`; return; }
  const mvs = (S.selectMode || S.hFilter.by || S.hFilter.tag) ? [] : (S.moves[mk]||[]).map(m=>({...m, _move:true}));
  const rows=[...ex.map(e=>({...e,_move:false})), ...mvs].sort((a,b)=>(b.date>a.date?1:b.date<a.date?-1:b.ts-a.ts));
  let html='',day=null,dayTotal=0,buf=[];
  const flush=()=>{ if(day){ html+=`<li class="day"><span>${esc(dayLabel(day))}</span><span class="num">${esc(fmtBase(dayTotal))}</span></li>`+buf.join(''); } buf=[];dayTotal=0; };
  for(const r of rows){ if(r.date!==day){ flush(); day=r.date; } if(r._move){ buf.push(moveRowHTML(r)); } else { dayTotal+=r.usd; buf.push(rowHTML(r, S.selectMode)); } }
  flush(); list.innerHTML=html;
}
function renderPlan(){
  const active=S.recurring.filter(r=>r.active!==false); const total=active.reduce((a,r)=>a+recMonthlyUSD(r),0);
  const inc=incomeUSD(); const cm=monthKey(new Date()); const cur=monthStats(cm); const avgDay = projectedTotal(cur);
  const payOf={}; { const links=monthLinks(cm); for(const e of monthItems(cm)){ const id=links.get(e.id); if(id && !payOf[id]) payOf[id]=e; } }   // this month's logged payment per fixed cost
  $('planTiles').innerHTML = `
    <div class="tile"><span class="k">Income</span><span class="v" style="color:var(--good)">${esc(fmtBase(Math.round(inc)))}</span><span class="d">per month</span></div>
    <div class="tile"><span class="k">Fixed costs</span><span class="v">${esc(fmtBase(Math.round(total)))}</span><span class="d">${active.length} active · ${cur.paidN? cur.paidN+' paid this month' : esc(fmtShort(total*12))+' a year'}</span></div>
    <div class="tile"><span class="k">After fixed costs</span><span class="v">${esc(fmtBase(Math.round(inc-total)))}</span><span class="d">${inc>0? Math.round((inc-total)/inc*100)+'% of income free' : 'add your income'}</span></div>
    <div class="tile"><span class="k">${cur.elapsed>=3?'Projected left':'Left so far'}</span><span class="v" style="color:${inc-total-avgDay>=0?'var(--good)':'var(--bad)'}">${esc(fmtBase(Math.round(inc-total-avgDay)))}</span><span class="d">${cur.elapsed>=3?'this month, at the current pace':'this month · too early to project'}</span></div>`;
  const il=$('incomeList');
  if(!S.loaded){ il.innerHTML='<li class="empty">Loading…</li>'; }
  else if(!S.income.length){ il.innerHTML='<li class="empty"><b>No income recorded.</b><br>Add your salary and Aya\'s so the dashboard shows what is left each month.</li>'; }
  else il.innerHTML=[...S.income].sort((a,b)=>recMonthlyUSD(b)-recMonthlyUSD(a)).map(r=>{ const off=r.active===false; return `<li class="tap" data-inc="${esc(r.id)}" style="${off?'opacity:.5':''}"><span class="avatar av" style="background:${memberColor(r.by)};width:32px;height:32px;font-size:12px">${esc(initial(r.by||r.name))}</span><div class="main"><div class="desc">${esc(r.name)}</div><div class="meta"><span class="pill ${r.period==='yearly'?'yr':''}">${r.period==='yearly'?'Yearly':'Monthly'}</span> ${r.period==='yearly'?'≈ '+esc(fmtBase(recMonthlyUSD(r)))+'/mo':''}${r.by?' · '+esc(r.by):''}${off?' · paused':''}</div></div><div class="amt" style="color:var(--good)">+${esc(fmtAmt(r.amount,r.currency))}<small>${r.period==='yearly'?'per year':'per month'}</small></div></li>`; }).join('');
  const g=$('planGroups'); if(!S.loaded){ g.innerHTML='<div class="list"><div class="empty">Loading…</div></div>'; return; }
  if(!S.recurring.length){ g.innerHTML='<div class="list"><div class="empty"><b>No fixed costs yet.</b><br>Add subscriptions, the nanny or housekeeper salaries, rent, generator and internet bills. Yearly ones are spread per month in the totals.</div></div>'; return; }
  let html='';
  for(const [kind,label] of KINDS){ const items=S.recurring.filter(r=>(r.kind||'other')===kind).sort((a,b)=>recMonthlyUSD(b)-recMonthlyUSD(a)); if(!items.length) continue; const sub=items.filter(r=>r.active!==false).reduce((a,r)=>a+recMonthlyUSD(r),0);
    html+=`<div><div class="row-between" style="margin-bottom:6px"><h2>${label}</h2><span class="num muted" style="font-size:13px">${esc(fmtShort(sub))}/mo</span></div><ul class="list">`+items.map(r=>{ const m=recMonthlyUSD(r); const off=r.active===false;
      const pay=payOf[r.id]; const differs = pay && (r.variable || [m, m*12].every(v=>Math.abs(pay.usd-v)>Math.max(1,0.02*v))); const paid = pay? ` · <span class="paid">✓ paid ${esc(dayLabel(pay.date))}${differs? ' · '+esc(fmtBase(pay.usd)) : ''}</span>` : '';
      return `<li class="tap" data-rec="${esc(r.id)}" style="${off?'opacity:.5':''}"><div class="main"><div class="desc">${esc(r.name)}</div><div class="meta"><span class="pill ${r.period==='yearly'?'yr':''}">${r.period==='yearly'?'Yearly':'Monthly'}</span>${r.variable? ' <span class="pill">varies</span>' : ''} ${r.period==='yearly'?'≈ '+esc(fmtBase(m))+'/mo': (r.variable? '≈ typical' : '')}${r.day?' · day '+esc(r.day):''}${r.by?' · '+esc(r.by):''}${off?' · paused':''}${paid}</div></div><div class="amt">${esc(fmtAmt(r.amount,r.currency))}<small>${r.period==='yearly'?'per year':'per month'}</small></div></li>`; }).join('')+'</ul></div>'; }
  g.innerHTML=html;
}

// ---------- wealth ----------
function renderWealth(){
  const acc=S.accounts.filter(a=>a.active!==false); const assets=acc.filter(a=>!LIAB.includes(a.type)), debts=acc.filter(a=>LIAB.includes(a.type));
  const sumA=assets.reduce((t,a)=>t+accountUSD(a),0), sumD=debts.reduce((t,a)=>t+accountUSD(a),0), net=sumA-sumD;
  const everyday=assets.filter(a=>bucketOf(a)==='spending'); const saved=assets.filter(a=>bucketOf(a)==='saved');
  const liquid=everyday.filter(a=>['cash','bank','savings'].includes(a.type)).reduce((t,a)=>t+accountUSD(a),0); const savedUSD=saved.reduce((t,a)=>t+accountUSD(a),0);
  const savedThisMonth = S.check && S.check.month===monthKey(new Date()) ? (S.check.savedUSD||0) : 0;
  const gold=assets.filter(a=>a.type==='gold'); const grams=gold.reduce((t,a)=>t+(Number(a.grams)||0),0); const goldUSD=gold.reduce((t,a)=>t+accountUSD(a),0);
  $('nwTotal').textContent=fmtBase(Math.round(net)); $('nwTotal').style.color = net<0? '#ffb4b4' : '#fff';
  $('nwSub').innerHTML = `<span>Assets <b>${fmtShort(sumA)}</b></span><span>Debts <b>${fmtShort(sumD)}</b></span>${grams? `<span>Gold <b>${grams.toLocaleString()} g</b>${goldUSD? ' · '+fmtShort(goldUSD):''}</span>`:''}`;
  const cm=monthKey(new Date()); const st=monthStats(cm); const spend = projectedTotal(st) + st.fixed; const runway = spend>0? liquid/spend : null;
  // compare with the latest snapshot at least 30 days old; with less history than that, with the first one there is
  const pts=S.networth||[]; const cutoff=shiftMonthDate(30); const prev = pts.length>=2 ? ([...pts].reverse().find(p=>p.date<=cutoff) || pts[0]) : null; const prevNet = prev? prev.assets-prev.debts : null; const prevIs30 = !!(prev && prev.date<=cutoff);
  $('nwTiles').innerHTML = `
    <div class="tile"><span class="k">Everyday money</span><span class="v">${esc(fmtBase(Math.round(liquid)))}</span><span class="d">bank &amp; cash in hand${runway!=null? ' · '+(runway>=24?'2y+':runway.toFixed(1)+' mo')+' of spending':''}</span></div>
    <div class="tile"><span class="k">Long-term savings</span><span class="v" style="color:var(--good)">${esc(fmtBase(Math.round(savedUSD)))}</span><span class="d">${savedThisMonth? '+'+esc(fmtShort(savedThisMonth))+' put aside this month' : 'not touched'}</span></div>
    ${(()=>{ const cards=debts.filter(a=>a.type==='card'); if(!cards.length) return `<div class="tile"><span class="k">Debt ratio</span><span class="v">${sumA>0? Math.round(sumD/sumA*100)+'%' : '—'}</span><span class="d">debts vs assets</span></div>`; const owed=cards.reduce((t,a)=>t+accountUSD(a),0), lim=cards.reduce((t,a)=>t+(Number(a.limit)||0)/rate(a.currency),0); return `<div class="tile"><span class="k">Credit card debt</span><span class="v" style="color:var(--warn)">${esc(fmtBase(Math.round(owed)))}</span><span class="d">${lim>0? Math.round(owed/lim*100)+'% of the limit used' : 'set the limit on the card'}${cards.length>1?' · '+cards.length+' cards':''}</span></div>`; })()}
    <div class="tile"><span class="k">${prevIs30? '30-day change' : 'Change'}</span><span class="v" style="color:${prevNet==null?'inherit':net-prevNet>=0?'var(--good)':'var(--bad)'}">${prevNet==null? '—' : (net-prevNet>=0?'+':'−')+esc(fmtShort(Math.abs(net-prevNet)))}</span><span class="d">${prevNet==null? 'needs a few days of history' : (prevIs30? 'in net worth' : 'in net worth since '+esc(dayLabel(prev.date)))}</span></div>`;
  // by person (net per owner)
  const byO={}; for(const a of acc){ const o=a.owner||'Joint'; byO[o]=(byO[o]||0)+(LIAB.includes(a.type)? -accountUSD(a) : accountUSD(a)); }
  const names=owners().filter(o=>byO[o]!=null).concat(Object.keys(byO).filter(o=>!owners().includes(o))); const tot=names.reduce((t,o)=>t+Math.max(0,byO[o]),0)||1;
  $('nwSplit').innerHTML = names.map(o=>`<i style="width:${Math.max(0,byO[o])/tot*100}%;background:${ownerColor(o)}"></i>`).join('');
  $('nwLegend').innerHTML = names.length? names.map(o=>`<span><i class="dot" style="background:${ownerColor(o)};margin-right:5px"></i>${esc(o)} <b class="num">${esc(fmtBase(Math.round(byO[o])))}</b></span>`).join('') : '<span class="faint">Add accounts to see who holds what.</span>';
  // chart
  const card=$('nwChartCard'); if(pts.length>=2){ card.classList.remove('hide'); const box=$('nwChart'); const f=chartFrame(box,170,44,14,16,24); const labels=pts.map(p=>p.date.slice(5).replace('-','/'));
    const hasSaved=pts.some(p=>p.saved!=null); lineChart(box, f, [{name:'Net worth',color:'var(--p3)',values:pts.map(p=>p.assets-p.debts)}, ...(hasSaved? [{name:'Long-term savings',color:'var(--p4)',values:pts.map(p=>p.saved!=null? p.saved : null),dashed:true}] : [{name:'Debts',color:'var(--p2)',values:pts.map(p=>p.debts),dashed:true}])], labels, {aria:'Net worth over time', maxXLabels:5, tipTitle:i=>pts[i].date});
    $('nwChartSub').textContent = pts.length+' updates'; $('nwChartLegend').innerHTML='<span><i class="sw" style="background:var(--p3)"></i>Net worth</span>'+(hasSaved? '<span><i class="sw" style="background:var(--p4)"></i>Long-term savings (dashed)</span>' : '<span><i class="sw" style="background:var(--p2)"></i>Debts (dashed)</span>'); }
  else card.classList.add('hide');
  // accounts whose reading disagrees with what is logged
  const gaps=acc.filter(a=>S.recon[a.id] && S.recon[a.id].gap);
  const attn=$('attnCard');
  if(gaps.length){ attn.classList.remove('hide'); attn.innerHTML=`<h2 style="margin-bottom:8px">Needs a look</h2><div class="muted" style="font-size:13.5px;line-height:1.5">${gaps.map(a=>{ const r=S.recon[a.id]; return `<div><b>${esc(a.name)}</b>: ${esc(gapText(a, r))} (expected ${esc(fmtAmt(r.expected,a.currency))}, ${a.type==='card'?'owes':'has'} ${esc(fmtAmt(r.actual,a.currency))}). Tap it to explain.</div>`; }).join('')}</div>`; }
  else attn.classList.add('hide');
  // lists
  const row=a=>{ const t=accType(a.type); const v=accountUSD(a); const liab=LIAB.includes(a.type); const r=S.recon[a.id]; const gapChip = r? (r.gap? `<span class="gap">gap ${esc(fmtAmt(r.gap,a.currency))}</span>` : (r.confirmed? `<span class="gap ok">✓ reconciled</span>` : '')) : ''; const goldMeta = a.type==='gold'? `${(Number(a.grams)||0).toLocaleString()} g${Number(S.settings.goldPrice)? '' : ' · set the gold price in Settings'}` : (a.type==='card'? (()=>{ const parts=[]; if(a.limit){ parts.push(`limit ${fmtAmt(a.limit,a.currency)}`); if(a.available!=null) parts.push('available '+fmtAmt(a.available,a.currency)); } if(a.last4) parts.push('···'+a.last4); return parts.join(' · '); })() : ''); const orig=(a.type!=='gold' && a.currency!==S.settings.base)? `<small>${esc(fmtAmt(a.amount,a.currency))}</small>`:'';
    return `<li class="tap" data-acc="${esc(a.id)}"><span class="tagdot" aria-hidden="true">${typeIcon(a)}</span><div class="main"><div class="desc">${esc(a.name)} ${gapChip}</div><div class="meta"><i class="dot" style="background:${ownerColor(a.owner||'Joint')};margin-right:4px"></i>${esc(a.owner||'Joint')} · ${esc(typeLabel(a))}${goldMeta?' · '+esc(goldMeta):''}${a.mask?' · '+esc(a.mask):''}${a.note?' · '+esc(a.note):''}</div></div><div class="amt ${liab?'neg':'pos'}">${liab?'−':''}${esc(fmtBase(Math.round(v)))}${orig}</div></li>`; };
  const al=$('assetList'), dl=$('debtList');
  if(!S.loaded){ al.innerHTML='<li class="empty">Loading…</li>'; dl.innerHTML=''; return; }
  al.innerHTML = everyday.length? [...everyday].sort((a,b)=>accountUSD(b)-accountUSD(a)).map(row).join('') : '<li class="empty"><b>No everyday accounts yet.</b><br>Add the bank account and the cash in hand that spending flows through.</li>';
  const sl=$('savedList'); sl.innerHTML = saved.length? [...saved].sort((a,b)=>accountUSD(b)-accountUSD(a)).map(row).join('') : '<li class="empty"><b>No long-term savings yet.</b><br>Savings cash, gold and anything else you do not touch. Move money here with ↔ Transfer or "put 1000 aside".</li>';
  dl.innerHTML = debts.length? [...debts].sort((a,b)=>accountUSD(b)-accountUSD(a)).map(row).join('') : '<li class="empty">No debts recorded. Loans and credit-card balances go here.</li>';
}
function shiftMonthDate(days){ const d=new Date(); d.setDate(d.getDate()-days); return dateKey(d); }
/** One sentence on a reconciliation gap, in the account's own terms (a card owes; a bank or pocket holds). */
function gapText(a, r){ const amt=fmtAmt(Math.abs(r.gap),a.currency); if(a.type==='card') return r.gap>0? 'about '+amt+' charged to it that is not logged' : amt+' less owed than expected (a payment or refund not logged?)'; return r.gap<0? 'about '+amt+' left it that is not logged' : amt+' more than expected (money in that is not logged?)'; }

// ---------- insights: range & view ----------
function dataMonths(){ const cm=monthKey(new Date()); const set=new Set(S.monthKeys.filter(m=>m<=cm)); set.add(cm); return [...set].sort(); }
function availableMonths(){ const cm=monthKey(new Date()); const set=new Set(dataMonths()); for(let i=0;i<6;i++) set.add(shiftMonth(cm,-i)); return [...set].sort(); }
function rangeLabel(r){ if(r.length===1) return monthLabel(r[0]); const a=r[0], b=r[r.length-1]; const [ya]=a.split('-'), [yb]=b.split('-'); return (ya===yb? monthShort(a).replace(/ \d+$/,'') : monthShort(a))+' – '+monthLabel(b); }
function resetAI(){ S.aiDone=false; $('aiOut').textContent=''; $('aiStatus').textContent=''; }
function setRange(r){ S.range=[...new Set(r)].sort(); if(!S.range.length) S.range=[monthKey(new Date())]; resetAI(); renderInsights(); }
function isAll(){ const d=dataMonths(); return d.length>1 && d.every(m=>S.range.includes(m)) && S.range.every(m=>d.includes(m)); }
/** The person the Insights screen is filtered to (a member's canonical name), or null for the whole household. */
function viewName(){ const i=memberIdx(S.view); return i>=0? (S.settings.members||[])[i] : null; }
function setView(v){ S.view=v||''; lsSet('insView', S.view||null); resetAI(); renderInsights(); }
function renderRange(){
  const months=availableMonths(); const cm=monthKey(new Date()); const sel=new Set(S.range); const all=isAll();
  let html=''; months.forEach(m=>{ html+=`<button class="chip ${sel.has(m)&&!all?'on':''}" data-range="${m}">${esc(monthShort(m))}</button>`; });
  const strip=$('rangeStrip'); strip.innerHTML=html; $('rangeAll').classList.toggle('on',all);
  $('rangeLabel').innerHTML = esc(all? 'All time' : rangeLabel(S.range)) + (S.range.length>1? `<small>${S.range.length} months</small>` : '');
  $('rangeReset').classList.toggle('hide', S.range.length===1 && S.range[0]===cm);
  const ms=S.settings.members||[]; const who=viewName();
  $('viewSeg').innerHTML = `<button type="button" class="${!who?'on':''}" data-view="">${ms.length===2?'Both':'Everyone'}</button>`+ms.map(m=>`<button type="button" class="${who===m?'on':''}" data-view="${esc(m)}"><i class="dot" style="background:${memberColor(m)}"></i>${esc(m)}</button>`).join('');
  requestAnimationFrame(()=>{ const on=strip.querySelector('.chip.on:last-of-type'); if(on) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.clientWidth + on.offsetWidth + 12); else strip.scrollLeft=strip.scrollWidth; });
}
$('rangeAll').onclick=()=>setRange(dataMonths());
$('rangeStrip').addEventListener('click',e=>{ const b=e.target.closest('[data-range]'); if(!b) return; const v=b.dataset.range; const cur=new Set(S.range); if(isAll()){ setRange([v]); return; } if(cur.has(v)){ cur.delete(v); } else cur.add(v); setRange([...cur]); });
$('rangeReset').onclick=()=>setRange([monthKey(new Date())]);
$('viewSeg').addEventListener('click',e=>{ const b=e.target.closest('[data-view]'); if(b) setView(b.dataset.view); });

/** Stats for the selected months (optionally one person's), plus the same number of months before them for comparison. */
function rangeStats(who){
  const per=S.range.map(mk=>({mk, st:monthStats(mk, who)}));
  const agg={total:0,count:0,byTag:{},byPerson:{},byTagBy:{},items:[],fixed:0,months:per.length,loading:per.some(p=>S.monthLoading[p.mk]||!S.months[p.mk])};
  for(const {st} of per){ agg.total+=st.total; agg.count+=st.count; agg.items.push(...st.ex); for(const [t,v] of Object.entries(st.byTag)) agg.byTag[t]=(agg.byTag[t]||0)+v; for(const [p,v] of Object.entries(st.byPerson)) agg.byPerson[p]=(agg.byPerson[p]||0)+v; for(const [t,o] of Object.entries(st.byTagBy)){ const d=agg.byTagBy[t]||(agg.byTagBy[t]={}); for(const [p,v] of Object.entries(o)) d[p]=(d[p]||0)+v; } }
  agg.fixed = per.length? per[0].st.fixed : 0; agg.fixedTotal = per.reduce((a,p)=>a+p.st.fixed,0);   // fixed costs over the whole range (paid where logged, planned otherwise)
  const n=per.length; const prior={total:0,count:0,byTag:{},months:n,dim:0};
  for(let i=1;i<=n;i++){ const mk=shiftMonth(S.range[0],-i); const st=monthStats(mk, who); prior.total+=st.total; prior.count+=st.count; prior.dim+=st.dim; for(const [t,v] of Object.entries(st.byTag)) prior.byTag[t]=(prior.byTag[t]||0)+v; }
  return {per, agg, prior};
}
/** Average spend per weekday over the elapsed days of the months in view (index 0 = Sunday). */
function weekdayProfile(per){
  const tot=[0,0,0,0,0,0,0], occ=[0,0,0,0,0,0,0]; let days=0;
  for(const {mk, st} of per){ const [y,m]=mk.split('-').map(Number); for(let d=1; d<=st.elapsed; d++){ const w=new Date(y,m-1,d).getDay(); occ[w]++; days++; tot[w]+=st.byDay[d]||0; } }
  if(!days) return null; return {tot, occ, days, avg:tot.map((v,i)=>occ[i]? v/occ[i] : 0)};
}
/** Colours follow the category: the household's biggest categories in this period take the palette in order, so switching person never repaints a slice. */
function catColors(agg, all){
  const map={}; let i=0; const rank=o=>Object.entries(o.byTag).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  rank(all).slice(0,CAT_COLORS.length).forEach(t=>{ map[t]=CAT_COLORS[i++]; });
  rank(agg).slice(0,5).forEach(t=>{ if(!map[t]) map[t]= i<CAT_COLORS.length? CAT_COLORS[i++] : 'var(--faint)'; });
  return map;
}
/** Short computed observations about the period, most useful first. */
function highlightLines({per, agg, prior, who, isCur, st, all, members}){
  const out=[]; const tot=agg.total; if(!tot) return out;
  const n=per.length; const b=s=>`<b>${esc(s)}</b>`; const pct=v=>Math.round(v/tot*100);
  const cats=Object.entries(agg.byTag).sort((a,b)=>b[1]-a[1]);
  const [t0,v0]=cats[0];
  out.push({icon:TAG_ICON[t0]||'•', html:`${esc(t0)} is the biggest: ${b(fmtBase(Math.round(v0)))}, ${b(pct(v0)+'%')} of day-to-day${cats[1]? `, then ${esc(cats[1][0])} at ${pct(cats[1][1])}%` : ''}.`});
  // biggest mover against the period before; a month in progress is compared with the same share of last month
  const scale = isCur&&st ? st.elapsed/st.dim : 1; const vs = n===1? (isCur? "last month's pace" : 'last month') : `the ${n} months before`;
  if(prior.total>0){ let best=null;
    for(const t of new Set([...Object.keys(agg.byTag), ...Object.keys(prior.byTag)])){ const cur=agg.byTag[t]||0, pv=(prior.byTag[t]||0)*scale; if(Math.max(cur,pv)<Math.max(25, tot*0.04)) continue; const d=cur-pv; if(!best || Math.abs(d)>Math.abs(best.d)) best={t,cur,pv,d}; }
    if(best && Math.abs(best.d)>=Math.max(20, tot*0.03)){ const up=best.d>0; const p=best.pv>0? Math.round(Math.abs(best.d)/best.pv*100) : null;
      out.push({icon:up?'📈':'📉', html:`${esc(best.t)} is ${up?'up':'down'} ${p!=null&&p<400? b(p+'%') : b(fmtBase(Math.round(Math.abs(best.d))))} on ${vs} (${esc(fmtShort(best.cur))} vs ${esc(fmtShort(best.pv))}).`}); } }
  if(!who && members.length>1){ const parts=members.map(m=>({m, v:agg.byPerson[m]||0})).sort((a,b)=>b.v-a.v); if(parts[0].v>0){ const lead=parts[0]; const share=pct(lead.v);
    out.push({icon:'👥', html: share>=65? `${esc(lead.m)} paid for most of it: ${b(share+'%')} (${esc(fmtShort(lead.v))}).` : `Split ${parts.map(p=>esc(p.m)+' '+b(pct(p.v)+'%')).join(' · ')}.`}); } }
  else if(who && all.total>0){ out.push({icon:'👥', html:`${esc(who)} accounts for ${b(Math.round(tot/all.total*100)+'%')} of the household's day-to-day spending.`}); }
  const big=[...agg.items].sort((a,b)=>b.usd-a.usd)[0];
  if(big && big.usd>=tot*0.08) out.push({icon:'🧾', html:`Biggest single expense: ${esc(big.desc)} ${b(fmtBase(big.usd))}${!who&&big.by? ', '+esc(big.by) : ''} (${esc(dayLabel(big.date))}), ${pct(big.usd)}% of the total.`});
  const wd=weekdayProfile(per);
  if(wd && wd.days>=14){ const i=wd.avg.indexOf(Math.max(...wd.avg)); const week=(wd.avg[1]+wd.avg[2]+wd.avg[3]+wd.avg[4]+wd.avg[5])/5; const weekend=(i===0||i===6) && week>0;
    if(wd.avg[i]>0) out.push({icon:'📅', html:`${DAY_NAMES[i]}s cost the most: ${b(fmtBase(Math.round(wd.avg[i])))} on average${weekend? `, ${(wd.avg[i]/week).toFixed(1)}× a weekday` : ''}.`}); }
  if(isCur && st && st.elapsed>=3 && prior.total>0){ const proj=projectedTotal(st); const d=Math.round((proj-prior.total)/prior.total*100);
    out.push({icon:'⏱️', html:`At this pace the month ends near ${b(fmtBase(Math.round(proj)))}, ${d===0?'level with':(d>0? b('+'+d+'%')+' above' : b(Math.abs(d)+'%')+' below')} last month.`}); }
  const small=agg.items.filter(e=>e.usd<10); const sv=small.reduce((a,e)=>a+e.usd,0);
  if(small.length>=8 && sv>=tot*0.03) out.push({icon:'🪙', html:`${b(small.length)} small items under ${esc(fmtShort(10))} add up to ${b(fmtBase(Math.round(sv)))}.`});
  return out.slice(0,5);
}

function renderInsights(){
  renderRange();
  S.range.forEach(ensureMonth);
  const single=S.range.length===1; const mk=S.range[S.range.length-1]; const cm=monthKey(new Date()); const isCur = single && mk===cm; const n=S.range.length;
  for(let i=1;i<=n;i++) ensureMonth(shiftMonth(S.range[0],-i));
  const who=viewName(); const members=S.settings.members||[];
  const {per, agg, prior}=rangeStats(who); const all = who? rangeStats(null).agg : agg;   // household totals: shares, and stable category colours
  const st = single? per[0].st : null; const inc=incomeUSD(who);
  const recs=S.recurring.filter(r=>r.active!==false && shareOf(r,who)>0); const sharedRecs = who? recs.filter(r=>!String(r.by||'').trim()).length : 0;
  const fixedNote = (st && st.paidN? `${st.paidN} of ${recs.length} paid · counted here, not in day-to-day` : recs.length+' recurring')+(sharedRecs? ' · shared ones split' : '');
  // tiles
  if(single){
    const pvTotal=prior.total, pvDim=prior.dim||st.dim; const dailyAvg = st.elapsed? st.total/st.elapsed : 0; const projected = isCur ? projectedTotal(st) : st.total; const canProject = !isCur || st.elapsed>=3; const allIn = st.total+st.fixed;
    const delta=(a,b)=>{ if(!b) return ''; const p=Math.round((a-b)/b*100); if(Math.abs(p)<1) return '<span class="d">same as last month</span>'; return `<span class="d ${p>0?'up':'down'}">${p>0?'▲':'▼'} ${Math.abs(p)}% vs last month</span>`; };
    const left = inc - (isCur? projected : st.total) - st.fixed;
    $('tiles').innerHTML = `
      <div class="tile"><span class="k">All in</span><span class="v">${esc(fmtBase(allIn))}</span><span class="d">day-to-day + fixed costs, nothing twice${who? ' · '+esc(who) : ''}</span></div>
      ${inc>0? `<div class="tile"><span class="k">${isCur? (canProject?'Left at month end':'Left so far') :'Left over'}</span><span class="v" style="color:${left>=0?'var(--good)':'var(--bad)'}">${esc(fmtBase(Math.round(left)))}</span><span class="d">${Math.round(left/inc*100)}% of ${esc(fmtShort(inc))} income</span></div>` : `<div class="tile"><span class="k">${isCur?'Projected':'Daily average'}</span><span class="v">${esc(fmtBase(Math.round(isCur? projected+st.fixed : (st.total/st.dim))))}</span><span class="d">${isCur? (canProject? fmtBase(Math.round(dailyAvg))+' a day' : 'so far · too early to project') : 'per day'}</span></div>`}
      <div class="tile"><span class="k">Day-to-day</span><span class="v">${esc(fmtBase(st.total))}</span>${(isCur && st.elapsed<3 ? '' : delta(st.total, isCur? pvTotal*(st.elapsed/pvDim) : pvTotal))||'<span class="d">'+st.count+' items</span>'}</div>
      <div class="tile"><span class="k">Fixed costs</span><span class="v">${esc(fmtBase(st.fixed))}</span><span class="d">${esc(fixedNote)}</span></div>
      ${inc>0? `<div class="tile"><span class="k">${isCur?'Projected':'Daily average'}</span><span class="v">${esc(fmtBase(Math.round(isCur? projected+st.fixed : (st.total/st.dim))))}</span><span class="d">${isCur? (canProject? fmtBase(Math.round(dailyAvg))+' a day · '+st.elapsed+' of '+st.dim+' days' : 'so far · too early to project') : 'per day'}</span></div>
      <div class="tile"><span class="k">Income</span><span class="v" style="color:var(--good)">${esc(fmtBase(Math.round(inc)))}</span><span class="d">per month${who? ' · '+esc(who)+"'s" : ''}</span></div>` : ''}`;
  } else {
    const totals=per.map(p=>p.st.total); const hi=per[totals.indexOf(Math.max(...totals))], lo=per[totals.indexOf(Math.min(...totals))];
    const d = prior.total? Math.round((agg.total-prior.total)/prior.total*100) : null;
    const left=inc*n-agg.total-agg.fixedTotal;
    $('tiles').innerHTML = `
      <div class="tile"><span class="k">All in</span><span class="v">${esc(fmtBase(agg.total+agg.fixedTotal))}</span><span class="d">${n} months, day-to-day + fixed, nothing twice${who? ' · '+esc(who) : ''}</span></div>
      ${inc>0? `<div class="tile"><span class="k">Left over</span><span class="v" style="color:${left>=0?'var(--good)':'var(--bad)'}">${esc(fmtBase(Math.round(left)))}</span><span class="d">${Math.round(left/(inc*n)*100)}% of ${esc(fmtShort(inc*n))} income</span></div>` : `<div class="tile"><span class="k">Per month</span><span class="v">${esc(fmtBase(Math.round(agg.total/n)))}</span><span class="d">average day-to-day</span></div>`}
      <div class="tile"><span class="k">Day-to-day</span><span class="v">${esc(fmtBase(agg.total))}</span>${d==null?'<span class="d">'+agg.count+' items</span>':`<span class="d ${d>0?'up':'down'}">${d>0?'▲':'▼'} ${Math.abs(d)}% vs the ${n} months before</span>`}</div>
      <div class="tile"><span class="k">High / low</span><span class="v">${esc(fmtShort(hi.st.total))}<span class="muted" style="font-size:14px;font-weight:600"> / ${esc(fmtShort(lo.st.total))}</span></span><span class="d">${esc(monthShort(hi.mk))} / ${esc(monthShort(lo.mk))}</span></div>
      ${inc>0? `<div class="tile"><span class="k">Per month</span><span class="v">${esc(fmtBase(Math.round(agg.total/n)))}</span><span class="d">average day-to-day</span></div>
      <div class="tile"><span class="k">Income</span><span class="v" style="color:var(--good)">${esc(fmtBase(Math.round(inc*n)))}</span><span class="d">${esc(fmtShort(inc))} a month${who? ' · '+esc(who)+"'s" : ''}</span></div>` : ''}`;
  }
  // budget (household-wide; typed in the base currency, everything else here is in USD)
  const bc=$('budgetCard'); const budget=(Number(S.settings.budget)||0)/rate(S.settings.base);
  if(budget>0 && !who && single){ bc.classList.remove('hide'); const used=st.total+st.fixed; const pct=Math.min(100,used/budget*100); const left=budget-used; bc.innerHTML=`<div class="row-between"><h2>Monthly budget</h2><span class="num" style="font-weight:700">${esc(fmtBase(used))} <span class="muted">/ ${esc(fmtBase(budget))}</span></span></div><div class="track"><i class="${used>budget?'over':''}" style="width:${pct}%"></i></div><div class="muted" style="font-size:13px">${used>budget? '<span style="color:var(--bad);font-weight:700">Over by '+esc(fmtBase(used-budget))+'</span>' : esc(fmtBase(left))+' left'+(isCur&&st.dim>st.elapsed? ' · '+esc(fmtBase(Math.round(Math.max(0,left)/(st.dim-st.elapsed))))+' a day for the rest of the month':'')}</div>`; }
  else if(budget>0 && !who){ bc.classList.remove('hide'); const used=agg.total+agg.fixedTotal; const cap=budget*agg.months; const pct=Math.min(100,used/cap*100); bc.innerHTML=`<div class="row-between"><h2>Budget over ${agg.months} months</h2><span class="num" style="font-weight:700">${esc(fmtBase(used))} <span class="muted">/ ${esc(fmtBase(cap))}</span></span></div><div class="track"><i class="${used>cap?'over':''}" style="width:${pct}%"></i></div><div class="muted" style="font-size:13px">${used>cap? '<span style="color:var(--bad);font-weight:700">Over by '+esc(fmtBase(used-cap))+'</span>' : esc(fmtBase(cap-used))+' under budget'}</div>`; }
  else bc.classList.add('hide');
  // month check (current month, whole household): compares what was logged with how the balances actually moved
  const ck=$('checkCard'); const c=S.check;
  if(single && isCur && !who && c && c.month===mk){ ck.classList.remove('hide'); const allIn=c.spentUSD; const expected=c.incomeUSD+c.refundsUSD-allIn; const unexp = c.actualDelta==null? null : Math.round(c.actualDelta-expected-c.adjustUSD);
    const gapsN=Object.values(S.recon).filter(r=>r.gap).length;
    ck.innerHTML=`<div class="row-between"><h2>Month check</h2><span class="muted" style="font-size:12px">${esc(monthShort(mk))}</span></div>
      <div class="line"><span>Income received</span><b>${esc(fmtBase(Math.round(c.incomeUSD)))}</b></div>
      ${c.planned.length? `<div class="muted" style="font-size:12.5px;margin-top:-4px">${c.planned.map(p=>`${p.received?'✓':'·'} ${esc(p.name)}`).join(' · ')}</div>`:''}
      <div class="line"><span>Spending logged</span><b>−${esc(fmtBase(Math.round(c.spentUSD)))}</b></div>
      ${c.refundsUSD? `<div class="line"><span>Refunds</span><b>+${esc(fmtBase(Math.round(c.refundsUSD)))}</b></div>`:''}
      ${c.savedUSD? `<div class="line"><span>Moved to long-term savings</span><b style="color:var(--good)">${esc(fmtBase(Math.round(c.savedUSD)))}</b></div>`:''}
      <div class="line total"><span>Should have ${expected>=0?'grown':'shrunk'} by</span><b>${esc(fmtBase(Math.round(Math.abs(expected))))}</b></div>
      ${c.actualDelta==null? `<div class="unexp">Balances have ${esc(c.startDate? 'no reading before '+monthShort(mk) : 'no history yet')}; the check compares from next month.</div>` : `<div class="line"><span>Balances actually moved</span><b>${c.actualDelta>=0?'+':'−'}${esc(fmtBase(Math.round(Math.abs(c.actualDelta))))}</b></div>
      <div class="unexp ${Math.abs(unexp)<Math.max(20,0.02*allIn)?'ok':''}">${Math.abs(unexp)<Math.max(20,0.02*allIn)? 'Everything lines up.' : (unexp<0? esc(fmtBase(Math.abs(unexp)))+' left your accounts without being logged.' : esc(fmtBase(unexp))+' arrived that is not logged as income.')}${gapsN? ' '+gapsN+' account'+(gapsN>1?'s':'')+' need a look in Wealth.' : ''}</div>`}`; }
  else ck.classList.add('hide');
  // what stands out
  const lines=highlightLines({per, agg, prior, who, isCur, st, all, members});
  $('hlList').innerHTML = lines.length? lines.map(h=>`<li><span class="ic" aria-hidden="true">${h.icon}</span><span>${h.html}</span></li>`).join('') : `<li><span class="ic" aria-hidden="true">✨</span><span class="muted">${agg.loading? 'Loading…' : 'Log a few expenses and the patterns show up here.'}</span></li>`;
  // charts
  const colors=catColors(agg, all);
  drawDonut(agg, colors, who);
  drawCategoryBars(agg, prior, who, isCur, st, colors);
  drawWaterfall(agg, n, who, isCur, inc);
  if(single) drawDailyLines(mk, st, who); else drawMonthlyBars(per, who);
  drawWeekday(per, who);
  // who spent (household view only)
  $('whoCard').classList.toggle('hide', !!who);
  if(!who){
    const names=[...new Set([...members,...Object.keys(agg.byPerson)])].filter(nm=>members.includes(nm)||agg.byPerson[nm]); const tot=agg.total||1;
    $('splitBar').innerHTML = names.map(nm=>`<i style="width:${(agg.byPerson[nm]||0)/tot*100}%;background:${memberColor(nm)}"></i>`).join('');
    $('splitLegend').innerHTML = names.map(nm=>`<span><i class="dot" style="background:${memberColor(nm)};margin-right:5px"></i>${esc(nm)} <b class="num">${esc(fmtBase(agg.byPerson[nm]||0))}</b> ${agg.total?Math.round((agg.byPerson[nm]||0)/agg.total*100)+'%':''}</span>`).join('') || '<span class="faint">No spending in this period.</span>';
    $('whoGrid').innerHTML = agg.total? names.map(nm=>{ const v=agg.byPerson[nm]||0; const items=agg.items.filter(e=>(e.by||'Unknown')===nm); const top=Object.entries(agg.byTagBy).map(([t,o])=>[t,o[nm]||0]).sort((a,b)=>b[1]-a[1])[0];
      return `<div class="p"><div class="nm"><i class="dot" style="background:${memberColor(nm)}"></i>${esc(nm)}</div><div class="v">${esc(fmtBase(Math.round(v)))}</div><div class="d">${items.length} item${items.length===1?'':'s'}${items.length? ' · avg '+esc(fmtShort(v/items.length)) : ''}</div><div class="d">${top&&top[1]>0? 'mostly '+esc((TAG_ICON[top[0]]||'')+' '+top[0]) : '&nbsp;'}</div></div>`; }).join('') : '';
  }
  // biggest
  const big=[...agg.items].sort((a,b)=>b.usd-a.usd).slice(0,5);
  $('bigList').innerHTML = big.length? big.map(e=>rowHTML(e)).join('') : '<li class="empty" style="padding:12px">Nothing yet.</li>';
  $('aiBtn').textContent = S.aiDone? 'Analyze again' : 'Analyze'; $('aiBtn').classList.toggle('hide', !!S.aiCtl); $('aiStop').classList.toggle('hide', !S.aiCtl);
}
