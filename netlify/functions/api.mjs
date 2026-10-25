// JSON API for the ledger app. All routes need the household key.
import { HttpError, checkAuth, json, text, getSettings, getMonth, getRecurring, writeJSON, mutateList,
  parseNote, saveExpenses, toUSD, todayIn, shiftMonth, monthStats, analysisPrompt, claudeMessage, analysisModel, newId, TAGS, CURRENCIES, DEFAULT_SETTINGS } from "../lib/ledger.mjs";

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
      const [recurring, ...docs] = await Promise.all([getRecurring(), ...keys.map(k=>getMonth(k))]);
      const out={}; keys.forEach((k,i)=>out[k]=docs[i]);
      return json({settings, recurring, months:out, today, serverTime:Date.now()});
    }
    if(route==='month' && req.method==='GET'){
      const mk=url.searchParams.get('m'); if(!/^\d{4}-\d{2}$/.test(mk||'')) throw new HttpError(400,'Bad month');
      return json({month:mk, items: await getMonth(mk)});
    }

    // ---- expenses ----
    if(route==='expense' && req.method==='POST'){
      const by = String(body.by||'').slice(0,40);
      let items, via='manual';
      if(body.text){ const r=await parseNote(settings, String(body.text).slice(0,500), today); items=r.items; via=r.via; }
      else if(body.expense){ const e=body.expense; items=[{amount:Number(e.amount)||0, currency:CURRENCIES.includes(e.currency)?e.currency:settings.base, description:String(e.desc||e.description||'').slice(0,80)||'Expense', tag:TAGS.includes(e.tag)?e.tag:'Other', date:/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?e.date:today, by:e.by||null, note:e.note?String(e.note).slice(0,200):null}]; }
      else throw new HttpError(400,'Send text or expense');
      const needsFix = items.length===1 && !(items[0].amount>0);
      if(needsFix) return json({saved:[], draft:{...items[0], by: items[0].by||by}, via});
      const saved = await saveExpenses(settings, items, {by, source: body.source||(body.text?'text':'manual')});
      return json({saved, via});
    }
    if(route==='expense' && req.method==='PUT'){
      const e=body.expense||{}; const from=String(body.month||e.month||''); if(!e.id || !/^\d{4}-\d{2}$/.test(from)) throw new HttpError(400,'Need id and month');
      const date=/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?e.date:today; const to=date.slice(0,7); const cur=CURRENCIES.includes(e.currency)?e.currency:settings.base;
      const old=(await getMonth(from)).find(x=>x.id===e.id); if(!old) throw new HttpError(404,'Expense not found');
      const doc={...old, amount:Number(e.amount)||0, currency:cur, usd:toUSD(settings,e.amount,cur), desc:String(e.desc||'').slice(0,80)||'Expense', tag:TAGS.includes(e.tag)?e.tag:'Other', by:String(e.by||'').slice(0,40), date, month:to, note:e.note?String(e.note).slice(0,200):null};
      if(to===from){ await mutateList('months/'+from, items=>items.map(x=>x.id===e.id?doc:x)); }
      else { await mutateList('months/'+from, items=>items.filter(x=>x.id!==e.id)); await mutateList('months/'+to, items=>items.concat([doc])); }
      return json({saved:[doc]});
    }
    if(route==='expense' && req.method==='DELETE'){
      const {id, month}=body; if(!id || !/^\d{4}-\d{2}$/.test(month||'')) throw new HttpError(400,'Need id and month');
      await mutateList('months/'+month, items=>items.filter(x=>x.id!==id)); return json({ok:true});
    }

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
      const doc={ members: members.length?members:DEFAULT_SETTINGS.members, base: CURRENCIES.includes(s.base)?s.base:settings.base, rates:{USD:1, LBP:Number(s.rates?.LBP)||settings.rates.LBP, EUR:Number(s.rates?.EUR)||settings.rates.EUR}, budget:Number(s.budget)||null, timezone:String(s.timezone||settings.timezone||'Asia/Beirut') };
      await writeJSON('settings', doc); return json({settings:doc});
    }

    // ---- AI analysis (streams plain text) ----
    if(route==='analyze' && req.method==='POST'){
      const mk=/^\d{4}-\d{2}$/.test(body.month||'')? body.month : today.slice(0,7);
      const [recurring, cur, m1, m2] = await Promise.all([getRecurring(), getMonth(mk), getMonth(shiftMonth(mk,-1)), getMonth(shiftMonth(mk,-2))]);
      const st=monthStats(settings,cur,recurring,mk,today), s1=monthStats(settings,m1,recurring,shiftMonth(mk,-1),today), s2=monthStats(settings,m2,recurring,shiftMonth(mk,-2),today);
      if(!st.count && !recurring.length) return text('Nothing to analyze yet. Log a few expenses first.');
      const p=analysisPrompt(settings, mk, st, s1, s2, recurring, today);
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
