// The app's files (index.html, app.js, icons…) are served by the Worker itself from the GitHub repository: the build's
// manifest (dist/assets.json) says which files exist and their hashes; each file is fetched once from GitHub, verified
// against its hash, kept in the ledger's own storage and in Cloudflare's cache, and served from there. A release is
// adopted only once every file it lists has been fetched and verified, so a page never mixes two versions. A push to the
// repository is picked up within a few minutes, with no deploy step. If GitHub is unreachable the stored copies serve.
import { store, envVar } from "./storage.mjs";

const CHECK_EVERY = 5 * 60 * 1000;   // how often to look for a new build (only when someone opens a page)
const MEM_TTL = 20 * 1000;           // how long an isolate trusts its in-memory copy of the release record
const repo = () => envVar('ASSET_REPO') || 'rudysaliby/rudy-aya-ledger';
const branch = () => envVar('ASSET_BRANCH') || 'main';
const raw = (path) => `https://raw.githubusercontent.com/${repo()}/${branch()}/${path}`;
const UA = {'user-agent': 'rudy-aya-ledger'};

const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hashOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
const plain = (msg, status, extra = {}) => new Response(msg, {status, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra}});

let mem = {rel: null, at: 0};
let adopting = null;   // the in-flight adoption, so concurrent requests do not each fetch GitHub

/** Fetch every file of a manifest that is not stored yet, verify it, store it. Returns true when the release is complete. */
async function fetchRelease(man){
  const s = store();
  for(const [path, f] of Object.entries(man.files)){
    if(await s.get('files/' + f.hash, {type:'json'})) continue;
    const r = await fetch(raw('public' + path), {headers: UA});
    if(!r.ok) throw new Error(`${path} → ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if(await hashOf(bytes) !== f.hash) throw new Error(`${path} has not propagated yet`);
    await s.setJSON('files/' + f.hash, toB64(bytes));
  }
  return true;
}

/** Make a verified manifest the current release and drop stored files no longer referenced. */
async function adopt(man, now){
  const s = store();
  const rel = {built: man.built, files: man.files, checkedAt: now, since: new Date(now).toISOString()};
  await s.setJSON('release', rel); mem = {rel, at: Date.now()};
  const keep = new Set(Object.values(man.files).map(f => 'files/' + f.hash));
  for(const k of (await s.list({prefix: 'files/'})).blobs.map(b => b.key)) if(!keep.has(k)) await s.delete(k);
  return rel;
}

/**
 * The release in use. Every CHECK_EVERY the manifest on GitHub is compared with it; a new build is fetched and verified in
 * the background (ctx.waitUntil) and becomes current on the next page load — or at once when there is no release yet.
 */
export async function currentRelease(ctx, {refresh = false} = {}){
  const now = Date.now();
  if(!refresh && mem.rel && now - mem.at < MEM_TTL) return mem.rel;
  const s = store(); let rel = await s.get('release', {type:'json'}); mem = {rel, at: now};
  if(rel && !refresh && now - (rel.checkedAt || 0) < CHECK_EVERY) return rel;
  const check = async () => {
    try{
      const r = await fetch(raw('dist/assets.json'), {headers: UA, cf: {cacheTtl: 60}});
      if(!r.ok) throw new Error('manifest → ' + r.status);
      const man = await r.json();
      if(!man || !man.files || typeof man.files !== 'object') throw new Error('manifest unreadable');
      if(rel && rel.built === man.built){ rel.checkedAt = Date.now(); await s.setJSON('release', rel); mem = {rel, at: Date.now()}; return rel; }
      await fetchRelease(man);
      return adopt(man, Date.now());
    }catch(e){
      console.log('[static] release check failed:', e.message);
      if(rel){ rel.checkedAt = Date.now(); await s.setJSON('release', rel); mem = {rel, at: Date.now()}; }   // try again in CHECK_EVERY
      return rel;
    }finally{ adopting = null; }
  };
  if(!adopting) adopting = check();
  if(!rel || refresh) return adopting;          // nothing to serve yet (or asked to wait): wait for it
  if(ctx && ctx.waitUntil) ctx.waitUntil(adopting); // otherwise serve what we have; the new build lands in the background
  return rel;
}

/** Serve one of the app's files. */
export async function serveStatic(req, ctx){
  const url = new URL(req.url); let path = url.pathname; if(path === '/') path = '/index.html';
  const rel = await currentRelease(ctx, {refresh: path === '/index.html' && url.searchParams.has('refresh')});
  if(!rel) return plain('The app files are not available yet (could not reach GitHub). Try again in a minute.', 503, {'retry-after': '60'});
  const f = rel.files[path]; if(!f) return plain('Not found', 404);
  const longLived = /^\/(icons\/|apple-touch-icon)/.test(path);
  const headers = {'content-type': f.type, 'etag': `"${f.hash}"`, 'cache-control': longLived ? 'public, max-age=86400' : 'no-cache', 'x-release': rel.built};
  if((req.headers.get('if-none-match') || '').includes(f.hash)) return new Response(null, {status: 304, headers});
  const cache = caches.default; const key = new Request(`https://files.rudy-aya-ledger.invalid/${f.hash}`);
  const hit = await cache.match(key);
  if(hit) return new Response(hit.body, {status: 200, headers});
  const stored = await store().get('files/' + f.hash, {type:'json'});
  if(!stored) return plain('This file is missing from storage; it will be fetched again shortly.', 503, {'retry-after': '30'});
  const bytes = fromB64(stored);
  if(ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, new Response(bytes, {headers: {'content-type': f.type, 'cache-control': 'public, max-age=31536000'}})));
  return new Response(bytes, {status: 200, headers});
}

export async function releaseInfo(){ const rel = await store().get('release', {type:'json'}); return rel ? {built: rel.built, since: rel.since, files: Object.keys(rel.files).length} : null; }
