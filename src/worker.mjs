// Cloudflare Worker entry: API routes here, data in one Durable Object, the app's files served from the GitHub repo (static.mjs).
import { DurableObject } from "cloudflare:workers";
import { bindRuntime, store, envVar, defineLedgerStore } from "./storage.mjs";
import { HttpError, checkAuth, json, text } from "./lib/ledger.mjs";
import api from "./routes/api.mjs";
import sms from "./routes/sms.mjs";
import pay from "./routes/pay.mjs";
import siri from "./routes/siri.mjs";
import { serveStatic, currentRelease, releaseInfo } from "./static.mjs";

export const LedgerStore = defineLedgerStore(DurableObject);

/**
 * First run on a fresh store: copy everything from the previous address (IMPORT_FROM) using the same household key, so
 * the move is invisible to the phones. Runs once; `meta/import` records what happened. Can be re-run with POST /api/import.
 */
async function importFrom(base, {force=false}={}){
  const s = store(); const key = envVar('HOUSEHOLD_KEY'); base = String(base||'').replace(/\/+$/, '');
  if(!base || !key) return {skipped:'no address or key'};
  if(!force){ const lock = await s.setJSON('meta/import', {state:'running', from:base, at:new Date().toISOString()}, {onlyIfNew:true}); if(lock && lock.modified===false) return {skipped:'already imported'}; }
  const H = {'x-ledger-key': key};
  const get = async (path) => { const r = await fetch(base + path, {headers:H}); if(!r.ok) throw new Error(`${path} → ${r.status}`); return r.json(); };
  try{
    const today = new Date().toISOString().slice(0,10);
    const st = await get('/api/state?today=' + today);
    const written = [];
    if(st.settings) { await s.setJSON('settings', st.settings); written.push('settings'); }
    for(const k of ['recurring','income','accounts']){ if(Array.isArray(st[k])){ await s.setJSON(k, {items: st[k]}); written.push(k); } }
    if(Array.isArray(st.networth)){ await s.setJSON('networth', {points: st.networth}); written.push('networth'); }
    // every month that has expenses, plus the months the state already carried (moves live there too)
    const keys = new Set([...(st.monthKeys||[]), ...Object.keys(st.months||{}), ...Object.keys(st.moves||{})]);
    let months = 0;
    for(const mk of [...keys].sort()){
      let items = st.months && st.months[mk], moves = st.moves && st.moves[mk];
      if(!items || !moves){ const m = await get('/api/month?m=' + mk); items = items || m.items || []; moves = moves || m.moves || []; }
      if(items.length){ await s.setJSON('months/' + mk, {items}); }
      if(moves.length){ await s.setJSON('moves/' + mk, {items: moves}); }
      months++;
    }
    const result = {state:'done', from:base, at:new Date().toISOString(), written, months};
    await s.setJSON('meta/import', result); return result;
  }catch(e){
    await s.setJSON('meta/import', {state:'failed', from:base, at:new Date().toISOString(), error:String(e.message||e)}).catch(()=>{});
    throw e;
  }
}

async function ensureImported(){
  const from = envVar('IMPORT_FROM'); if(!from) return;
  const s = store(); const meta = await s.get('meta/import', {type:'json'});
  if(meta && meta.state !== 'failed') return;                       // done, or in progress
  const hasData = await s.get('settings', {type:'json'}); if(hasData && !meta) return;   // a store already in use: never overwrite
  try{ await importFrom(from); }catch(e){ console.log('[import] failed', e.message); }
}

export default {
  async fetch(req, env, ctx){
    bindRuntime({env});
    const url = new URL(req.url); const p = url.pathname;
    try{
      // backup and restore: /api/export downloads every data document; POST /api/import with that file's {docs} puts them back,
      // or with {from: "https://old-address"} copies the data from a previous installation that uses the same household key
      if(p === '/api/export' && req.method === 'GET'){ checkAuth(req); const docs = (await store().dump()).filter(d => !/^(files\/|release$|meta\/)/.test(d.key)); return new Response(JSON.stringify({exported:new Date().toISOString(), docs}), {headers:{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="ledger-export.json"','cache-control':'no-store'}}); }
      if(p === '/api/import' && req.method === 'POST'){ checkAuth(req); const b = await req.json().catch(()=>({}));
        if(Array.isArray(b.docs)){ const docs = b.docs.filter(d => d && typeof d.key === 'string' && typeof d.body === 'string' && !/^(files\/|release$|meta\/)/.test(d.key)); const n = await store().load(docs); return json({restored:n}); }
        if(b.from){ const r = await importFrom(b.from, {force:true}); return json(r); }
        throw new HttpError(400, 'Send {docs} from an export, or {from} with a previous address'); }
      if(p === '/api/health'){ const meta = await store().get('meta/import', {type:'json'}); return json({ok:true, platform:'cloudflare', release: await releaseInfo(), import: meta ? meta.state : null}); }
      if(p === '/api/release' && req.method === 'POST'){ checkAuth(req); const rel = await currentRelease(ctx, {refresh:true}); return json(rel ? {built: rel.built, files: Object.keys(rel.files).length} : {error:'GitHub unreachable'}, rel ? 200 : 502); }
      if(p.startsWith('/api/')){ await ensureImported(); return api(req); }
      if(p === '/sms') return sms(req);
      if(p === '/pay') return pay(req);
      if(p === '/siri') return siri(req);
      return serveStatic(req, ctx);
    }catch(e){
      const status = e instanceof HttpError ? e.status : 500;
      return json({error: e.message || 'Server error'}, status);
    }
  },
};
