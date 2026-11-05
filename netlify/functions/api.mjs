// JSON API for the ledger app. All routes need the household key.
import { HttpError, checkAuth, json, text, getSettings, getMonth, getRecurring, getIncome, incomeMonthlyUSD, getAccounts, getNetworthPoints, accountUSD, netWorth, recordSnapshot, bucketOf, ACCOUNT_TYPES, LIABILITY_TYPES, writeJSON, mutateList, listMonthKeys,
  parseNote, saveExpenses, toUSD, todayIn, shiftMonth, monthStats, analysisPrompt, rangeAnalysisPrompt, claudeMessage, analysisModel, newId, TAGS, CURRENCIES, DEFAULT_SETTINGS } from "../lib/ledger.mjs";
import { getMoves, saveMove, deleteMove, accountOfType, confirmBalance, advanceBaseline, reconcile, monthCheck, rollStatements, mergeDuplicateCash, withSync, MOVE_KINDS } from "../lib/flow.mjs";
import { bookItems, resolveAcc } from "../lib/book.mjs";

export const config = { path: "/api/*" };

export default async (req) => {
  try{
    const url = new URL(req.url);
    const route = (url.pathname.match(/\/api\/(.*)$/)||[])[1] || '';
    if(route==='health') return json({ok:true});
    checkAuth(req);
    const body = req.method==='GET' ? {} : (await req.json().catch(()=>({})));
    const settings = await getSettings();
    const today = body.today && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : (url.searchParams.get('today') && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today')) ? url.searchParams.get('today') : todayIn(settings.timezone));

    // ---- state: settings + recurring + a window of months ----
    if(route==='state' && req.method==='GET'){
      const months=(url.searchParams.get('months')||'').split(',').filter(m=>/^\d{4}-\d{2}$/.test(m));
      const keys = months.length? months : (()=>{ const cm=today.slice(0,7); const a=[]; for(let i=5;i>=0;i--) a.push(shiftMonth(cm,-i)); return a; })();
      // housekeeping first (fold duplicate cash accounts, missing baselines, statement day), then read everything
      let accounts=null; try{ await mergeDuplicateCash(settings, today); accounts=await rollStatements(settings, today); }catch(e){}
      const [recurring, income, accounts0, networth, monthKeys, ...docs] = await Promise.all([getRecurring(), getIncome(), accounts? Promise.resolve(accounts) : getAccounts(), getNetworthPoints(), listMonthKeys(), ...keys.map(k=>getMonth(k))]);
      accounts=accounts0;
      const mv=await Promise.all(keys.map(k=>getMoves(k)));
      const out={}, moves={}; keys.forEach((k,i)=>{ out[k]=docs[i]; moves[k]=mv[i]; });
      let recon={}; try{ recon=await reconcile(settings, accounts, today, {months:out, moves}); }catch(e){}   // months not in the window are fetched as needed
      let check=null; try{ check=await monthCheck(settings, today.slice(0,7), accounts, networth, today); }catch(e){}
      return json({settings, recurring, income, accounts, networth, recon, check, months:out, moves, monthKeys, today, serverTime:Date.now()});
    }
    if(route==='month' && req.method==='GET'){
      const mk=url.searchParams.get('m'); if(!/^\d{4}-\d{2}$/.test(mk||'')) throw new HttpError(400,'Bad month');
      const [items, moves]=await Promise.all([getMonth(mk), getMoves(mk)]); return json({month:mk, items, moves});
    }

    // ---- expenses ----
    if(route==='expense' && req.method==='POST'){
      const by = String(body.by||'').slice(0,40);
      let items, via='manual';
      const accounts=await getAccounts();
      if(body.text){ const r=await parseNote(settings, String(body.text).slice(0,500), today); items=r.items; via=r.via; }
      else if(body.expense){ const e=body.expense; items=[{amount:Number(e.amount)||0, currency:CURRENCIES.includes(e.currency)?e.currency:settings.base, description:String(e.desc||e.description||'').slice(0,80)||'Expense', tag:TAGS.includes(e.tag)?e.tag:'Other', date:/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?e.date:today, by:e.by||null, note:e.note?String(e.note).slice(0,200):null, from: e.from==='none'? 'none' : (e.from||null)}]; }
      else throw new HttpError(400,'Send text or expense');
      // transfers in the note ("moved 2000 to cash", "paid the card 4000") become movements; expenses leave the account that paid
      const r=await bookItems(settings, items, {by, source: body.source||(body.text?'text':'manual'), today, accounts});
      if(r.draft) return json({saved:[], moves:r.moves, draft:r.draft, via});
      return json({saved:r.saved, moves:r.moves, via});
    }
    if(route==='expense' && req.method==='PUT'){
      const e=body.expense||{}; const from=String(body.month||e.month||''); if(!e.id || !/^\d{4}-\d{2}$/.test(from)) throw new HttpError(400,'Need id and month');
      const date=/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?e.date:today; const to=date.slice(0,7); const cur=CURRENCIES.includes(e.currency)?e.currency:settings.base;
      const old=(await getMonth(from)).find(x=>x.id===e.id); if(!old) throw new HttpError(404,'Expense not found');
      let newFrom = e.from===undefined? (old.from||null) : (e.from||null);
      if(newFrom==='none') newFrom=null; else if(newFrom==='auto'){ const accs=await getAccounts(); const owner=e.by||old.by||body.by||''; newFrom=await resolveAcc(settings, accs, (settings.defaultPaid||{})[owner]||'cash', owner); }
      const doc={...old, amount:Number(e.amount)||0, currency:cur, usd:toUSD(settings,e.amount,cur), desc:String(e.desc||'').slice(0,80)||'Expense', tag:TAGS.includes(e.tag)?e.tag:'Other', by:String(e.by||'').slice(0,40), date, month:to, note:e.note?String(e.note).slice(0,200):null, from:newFrom};
      await withSync(settings, today, [old.from, newFrom], async()=>{
        if(to===from){ await mutateList('months/'+from, items=>items.map(x=>x.id===e.id?doc:x)); }
        else { // add to the new month before removing from the old one: a failure in between leaves a duplicate, never a loss
          await mutateList('months/'+to, items=>items.some(x=>x.id===e.id)? items.map(x=>x.id===e.id?doc:x) : items.concat([doc])); await mutateList('months/'+from, items=>items.filter(x=>x.id!==e.id)); } });
      return json({saved:[doc]});
    }
    if(route==='expense' && req.method==='DELETE'){
      const {id, month}=body; if(!id || !/^\d{4}-\d{2}$/.test(month||'')) throw new HttpError(400,'Need id and month');
      const ex=(await getMonth(month)).find(x=>x.id===id); await withSync(settings, today, ex? [ex.from] : [], ()=>mutateList('months/'+month, items=>items.filter(x=>x.id!==id))); return json({ok:true});
    }
    if(route==='expenses/delete' && req.method==='POST'){
      const list=Array.isArray(body.items)? body.items.filter(x=>x && x.id && /^\d{4}-\d{2}$/.test(x.month||'')).slice(0,500) : [];
      if(!list.length) throw new HttpError(400,'Nothing to delete');
      const byMonth={}; for(const x of list){ (byMonth[x.month]=byMonth[x.month]||new Set()).add(String(x.id)); }
      // the accounts these were paid from get the money back
      const fromIds=new Set(); for(const [mk,ids] of Object.entries(byMonth)){ (await getMonth(mk)).forEach(x=>{ if(ids.has(x.id) && x.from) fromIds.add(x.from); }); }
      let removed=0;
      await withSync(settings, today, [...fromIds], async()=>{ for(const [mk,ids] of Object.entries(byMonth)){ await mutateList('months/'+mk, items=>{ const keep=items.filter(x=>!ids.has(x.id)); removed+=items.length-keep.length; return keep; }); } });
      return json({ok:true, removed});
    }

    // ---- moves (transfers, income landed, refunds, adjustments) ----
    if(route==='move' && req.method==='POST'){
      const m=body.move||{}; const doc=await withSync(settings, today, [m.fromAcc, m.toAcc], ()=>saveMove(settings, {id:m.id, kind:MOVE_KINDS.includes(m.kind)?m.kind:'transfer', fromAcc:m.fromAcc||null, toAcc:m.toAcc||null, amount:m.amount, currency:CURRENCIES.includes(m.currency)?m.currency:settings.base, desc:m.desc, date:/^\d{4}-\d{2}-\d{2}$/.test(m.date||'')?m.date:today, incomeId:m.incomeId||null, note:m.note, ts:m.ts}, {by:body.by||m.by||'', source:'manual'}));
      return json({saved:doc});
    }
    if(route==='move' && req.method==='DELETE'){
      const {id, month}=body; if(!id || !/^\d{4}-\d{2}$/.test(month||'')) throw new HttpError(400,'Need id and month');
      const mv=(await getMoves(month)).find(x=>x.id===id); await withSync(settings, today, mv? [mv.fromAcc, mv.toAcc] : [], ()=>deleteMove(month, id));
      return json({ok:true});
    }
    // ---- account: confirm the actual balance, or explain a gap ----
    if(route==='account/confirm' && req.method==='POST'){
      const {id, amount}=body; if(!id) throw new HttpError(400,'Need id'); const accounts=await getAccounts(); const acc=accounts.find(a=>a.id===id); if(!acc) throw new HttpError(404,'No such account');
      const extra = acc.type==='card' && Number(acc.limit)>0 ? {available: Math.max(0, Number(acc.limit)-Number(amount))} : {};
      const r=await confirmBalance(settings, id, Number(amount)||0, today, extra); const recon=await reconcile(settings, r.accounts, today);
      return json({accounts:r.accounts, recon, networth: await getNetworthPoints()});
    }
    if(route==='account/resolve' && req.method==='POST'){
      // action: withdrawal (bank→cash), expense (forgotten spending), fee, accept (adjustment)
      const {id, action}=body; const accounts=await getAccounts(); const acc=accounts.find(a=>a.id===id); if(!acc) throw new HttpError(404,'No such account');
      const recon=await reconcile(settings, accounts, today); const gap=recon[id]? recon[id].gap : 0; if(!gap) return json({accounts, recon, ok:true});
      const liab=acc.type==='card'; const missingOut = liab? gap>0 : gap<0;   // money left the account that we never logged
      const amount=Math.abs(gap); const owner=acc.owner&&acc.owner!=='Joint'? acc.owner : (body.by||'');
      // the explained account keeps its reading; the other side of a withdrawal follows the booking (cash in hand goes up),
      // unless that side is a bank whose own reading is newer, in which case the movement is dated before that reading
      if(action==='withdrawal' && missingOut && !liab){ const cash=await accountOfType(settings, accounts, 'cash', owner, {create:true, currency:'USD'}); await withSync(settings, today, [cash?cash.id:null], ()=>saveMove(settings, {kind:'transfer', fromAcc:acc.id, toAcc:cash?cash.id:null, amount, currency:acc.currency, desc:'Cash withdrawal (reconciled)', date:today}, {by:owner, source:'resolve'})); }
      else if(action==='withdrawal' && !missingOut && acc.type==='cash'){ const bank=await accountOfType(settings, accounts, 'bank', owner); const ts = bank && bank.confirmed && bank.confirmed.ts ? Math.min(Date.now(), bank.confirmed.ts-1) : Date.now(); await saveMove(settings, {kind:'transfer', fromAcc:bank?bank.id:null, toAcc:acc.id, amount, currency:acc.currency, desc:'Cash withdrawal (reconciled)', date:today, ts}, {by:owner, source:'resolve'}); }
      else if(action==='expense' && missingOut){ await saveExpenses(settings, [{amount, currency:acc.currency, description: body.desc? String(body.desc).slice(0,80) : 'Untracked spending', tag: TAGS.includes(body.tag)? body.tag : 'Other', date:today, by:owner||null, note:'Added to explain a balance gap', from:acc.id}], {by:owner, source:'resolve'}); }
      else if(action==='fee' && missingOut){ await saveExpenses(settings, [{amount, currency:acc.currency, description:'Bank fees / interest', tag:'Fees', date:today, by:owner||null, note:'Added to explain a balance gap', from:acc.id}], {by:owner, source:'resolve'}); }
      else { // accept: book the difference as an adjustment so expected matches actual from here on
        await saveMove(settings, {kind:'adjust', fromAcc: missingOut? acc.id : null, toAcc: missingOut? null : acc.id, amount, currency:acc.currency, desc:'Balance adjustment', date:today}, {by:owner, source:'resolve'}); }
      const accounts2=await advanceBaseline(id, today); const recon2=await reconcile(settings, accounts2, today);
      return json({accounts:accounts2, recon:recon2, ok:true});
    }

    // ---- income ----
    if(route==='income' && req.method==='POST'){
      const r=body.item||{};
      const doc={ id:r.id||newId(), name:String(r.name||'').slice(0,60)||'Income', amount:Number(r.amount)||0, currency:CURRENCIES.includes(r.currency)?r.currency:settings.base, period:r.period==='yearly'?'yearly':'monthly', by:String(r.by||'').slice(0,40), active:r.active!==false, ts:r.ts||Date.now() };
      const items=await mutateList('income', items=>{ const i=items.findIndex(x=>x.id===doc.id); if(i>=0) items[i]=doc; else items.push(doc); return items; });
      return json({saved:doc, income:items});
    }
    if(route==='income' && req.method==='DELETE'){ const items=await mutateList('income', items=>items.filter(x=>x.id!==body.id)); return json({income:items}); }

    // ---- accounts (savings, bank, gold, debts) ----
    if(route==='account' && req.method==='POST'){
      const a=body.item||{}; const type=ACCOUNT_TYPES.includes(a.type)? a.type : 'bank';
      const prev=(await getAccounts()).find(x=>x.id===a.id)||null;
      const doc={ id:a.id||newId(), name:String(a.name||'').slice(0,60)||'Account', type, owner:String(a.owner||'').slice(0,40), amount:Math.abs(Number(a.amount))||0, currency:CURRENCIES.includes(a.currency)?a.currency:settings.base, grams: type==='gold'? (Math.abs(Number(a.grams))||0) : null, limit: type==='card'? (Math.abs(Number(a.limit))||null) : null, available: type==='card' && a.available!=='' && a.available!=null ? Math.abs(Number(a.available))||0 : null, last4: a.last4? String(a.last4).replace(/\D/g,'').slice(-4)||null : null, mask: a.mask? String(a.mask).trim().slice(0,30)||null : null, bucket: a.bucket==='saved'||a.bucket==='spending'? a.bucket : (prev? prev.bucket||null : null), note:a.note?String(a.note).slice(0,120):null, active:a.active!==false, updatedAt:today, ts:a.ts||Date.now(), confirmed: prev? prev.confirmed||null : null };
      if(type==='card' && doc.limit && doc.available!=null) doc.amount=Math.round((doc.limit-Math.min(doc.limit,doc.available))*100)/100;
      const isFlow=['cash','bank','savings','card'].includes(type);
      if(isFlow && !prev) doc.confirmed={amount:doc.amount, date:today, ts:Date.now()};           // a new account starts with its balance as the baseline
      // on an edit, a flow account keeps its balance here and takes the typed figure as a reading below; other accounts simply take it
      let items=await mutateList('accounts', items=>{ const i=items.findIndex(x=>x.id===doc.id); if(i>=0) items[i]=(prev && isFlow? {...doc, amount:prev.amount} : doc); else items.push(doc); return items; });
      if(isFlow && prev && Math.abs((prev.amount||0)-doc.amount)>0.004){ const r=await confirmBalance(settings, doc.id, doc.amount, today, type==='card'? {available:doc.available} : {}); if(r) items=r.accounts; }  // a typed balance is a reading
      const networth=await recordSnapshot(settings, items, today);
      const recon=await reconcile(settings, items, today);
      return json({saved:items.find(x=>x.id===doc.id)||doc, accounts:items, networth, recon});
    }
    if(route==='account' && req.method==='DELETE'){ const items=await mutateList('accounts', items=>items.filter(x=>x.id!==body.id)); const networth=await recordSnapshot(settings, items, today); const recon=await reconcile(settings, items, today); return json({accounts:items, networth, recon}); }

    // ---- recurring ----
    if(route==='recurring' && req.method==='POST'){
      const r=body.item||{};
      const doc={ id:r.id||newId(), name:String(r.name||'').slice(0,60)||'Untitled', amount:Number(r.amount)||0, currency:CURRENCIES.includes(r.currency)?r.currency:settings.base, period:r.period==='yearly'?'yearly':'monthly', kind:String(r.kind||'other'), by:String(r.by||'').slice(0,40), day:Number(r.day)||null, active:r.active!==false, ts:r.ts||Date.now() };
      const items=await mutateList('recurring', items=>{ const i=items.findIndex(x=>x.id===doc.id); if(i>=0) items[i]=doc; else items.push(doc); return items; });
      return json({saved:doc, recurring:items});
    }
    if(route==='recurring' && req.method==='DELETE'){ const items=await mutateList('recurring', items=>items.filter(x=>x.id!==body.id)); return json({recurring:items}); }

    // ---- settings ----
    if(route==='settings' && req.method==='PUT'){
      const s=body.settings||{}; const members=Array.isArray(s.members)? s.members.map(x=>String(x).trim().slice(0,30)).filter(Boolean) : settings.members;
      const people=Array.isArray(s.people)? s.people.map(x=>String(x).trim().slice(0,30)).filter(Boolean) : (settings.people||[]);
      const cashRules=Array.isArray(s.cashRules)? s.cashRules.map(x=>String(x).trim().slice(0,40)).filter(Boolean) : (settings.cashRules||DEFAULT_SETTINGS.cashRules);
      const defaultPaid={}; if(s.defaultPaid && typeof s.defaultPaid==='object'){ for(const [k,v] of Object.entries(s.defaultPaid)){ if(['cash','bank','card','savings'].includes(v)) defaultPaid[String(k).slice(0,30)]=v; } }
      const doc={ members: members.length?members:DEFAULT_SETTINGS.members, people, base: CURRENCIES.includes(s.base)?s.base:settings.base, rates:{USD:1, LBP:Number(s.rates?.LBP)||settings.rates.LBP, EUR:Number(s.rates?.EUR)||settings.rates.EUR, AED:Number(s.rates?.AED)||settings.rates.AED||3.6725}, budget:Number(s.budget)||null, timezone:String(s.timezone||settings.timezone||'Asia/Beirut'), goldPrice:Number(s.goldPrice)||null, cashRules, defaultPaid };
      await writeJSON('settings', doc);
      if(doc.goldPrice!==settings.goldPrice){ try{ await recordSnapshot(doc, await getAccounts(), today); }catch(e){} }
      return json({settings:doc});
    }

    // ---- AI analysis (streams plain text) ----
    if(route==='analyze' && req.method==='POST'){
      const sel=(Array.isArray(body.months)? body.months : [body.month]).filter(m=>/^\d{4}-\d{2}$/.test(m||'')).sort().slice(-24);
      const months = sel.length? sel : [today.slice(0,7)];
      const [recurring, income, accounts]=await Promise.all([getRecurring(), getIncome(), getAccounts()]); const incomeUSD=incomeMonthlyUSD(settings, income);
      const nw=netWorth(settings, accounts); nw.liquid=accounts.filter(a=>a.active!==false && ['cash','bank','savings'].includes(a.type) && bucketOf(a)==='spending').reduce((t,a)=>t+accountUSD(settings,a),0); nw.saved=accounts.filter(a=>a.active!==false && !LIABILITY_TYPES.includes(a.type) && bucketOf(a)==='saved').reduce((t,a)=>t+accountUSD(settings,a),0);
      try{ const ck=await monthCheck(settings, today.slice(0,7), accounts, [], today); nw.savedThisMonth=ck.savedUSD; }catch(e){}
      let p;
      if(months.length===1){
        const mk=months[0];
        const [cur, m1, m2] = await Promise.all([getMonth(mk), getMonth(shiftMonth(mk,-1)), getMonth(shiftMonth(mk,-2))]);
        const st=monthStats(settings,cur,recurring,mk,today), s1=monthStats(settings,m1,recurring,shiftMonth(mk,-1),today), s2=monthStats(settings,m2,recurring,shiftMonth(mk,-2),today);
        if(!st.count && !recurring.length) return text('Nothing to analyze yet. Log a few expenses first.');
        p=analysisPrompt(settings, mk, st, s1, s2, recurring, today, incomeUSD, nw);
      } else {
        const n=months.length; const priorKeys=[]; for(let i=n;i>=1;i--) priorKeys.push(shiftMonth(months[0],-i));
        const docs=await Promise.all([...months, ...priorKeys].map(k=>getMonth(k)));
        const perMonth=months.map((mk,i)=>({mk, st:monthStats(settings,docs[i],recurring,mk,today)}));
        const prior={total:0,byTag:{}}; priorKeys.forEach((mk,i)=>{ const st=monthStats(settings,docs[n+i],recurring,mk,today); prior.total+=st.total; for(const [t,v] of Object.entries(st.byTag)) prior.byTag[t]=(prior.byTag[t]||0)+v; });
        if(!perMonth.some(x=>x.st.count) && !recurring.length) return text('Nothing to analyze yet. Log a few expenses first.');
        p=rangeAnalysisPrompt(settings, perMonth, prior, recurring, incomeUSD, nw);
      }
      const up = await claudeMessage({ model: analysisModel(), system:p.system, messages:[{role:'user',content:p.user}], max_tokens:700, stream:true });
      const dec=new TextDecoder(), enc=new TextEncoder(); let buf='';
      const stream=new ReadableStream({ async start(ctl){ const reader=up.body.getReader(); try{ while(true){ const {value,done}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let i; while((i=buf.indexOf('\n'))>=0){ const line=buf.slice(0,i).trim(); buf=buf.slice(i+1); if(!line.startsWith('data:')) continue; try{ const ev=JSON.parse(line.slice(5)); if(ev.type==='content_block_delta' && ev.delta && ev.delta.type==='text_delta') ctl.enqueue(enc.encode(ev.delta.text)); if(ev.type==='error') ctl.enqueue(enc.encode('\n[Claude error: '+(ev.error?.message||'unknown')+']')); }catch(e){} } } }catch(e){ ctl.enqueue(enc.encode('\n[interrupted]')); } ctl.close(); } });
      return new Response(stream, {headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'}});
    }

    throw new HttpError(404, 'No such route');
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return json({error: e.message||'Server error'}, status);
  }
};
