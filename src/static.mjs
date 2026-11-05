// The app's files (index.html, app.js, icons…) are served by the Worker itself from the GitHub repository: the build's
// manifest (dist/assets.json) says which files exist and their hashes; each file is fetched once from GitHub, verified
// against its hash, kept in the ledger's own storage and in Cloudflare's cache, and served from there. A push to the
// repository is picked up within a few minutes, with no deploy step. If GitHub is unreachable the stored copies serve.
import { store, envVar } from "./storage.mjs";

const CHECK_EVERY = 5 * 60 * 1000;
const repo = () => envVar('ASSET_REPO') || 'rudysaliby/rudy-aya-ledger';
const branch = () => envVar('ASSET_BRANCH') || 'main';
const raw = (path) => `https://raw.githubusercontent.com/${repo()}/${branch()}/${path}`;

const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hashOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

/** The manifest in use; re-read from GitHub at most every few minutes (only when a page is opened). */
async function currentRelease({refresh = false} = {}){
  const s = store(); let rel = await s.get('release', {type:'json'}); const now = Date.now();
  if(rel && !refresh && now - (rel.checkedAt || 0) < CHECK_EVERY) return rel;
  try{
    const r = await fetch(raw('dist/assets.json'), {headers:{'user-agent':'rudy-aya-ledger'}, cf:{cacheTtl:60}});
    if(r.ok){
      const man = await r.json();
      if(!rel || rel.built !== man.built){
        rel = {built: man.built, files: man.files, checkedAt: now, since: new Date(now).toISOString()};
        await s.setJSON('release', rel);
        // drop stored copies of files no release refers to any more
        const keep = new Set(Object.values(man.files).map(f => 'files/' + f.hash));
        for(const k of (await s.list({prefix:'files/'})).blobs.map(b => b.key)) if(!keep.has(k)) await s.delete(k);
        return rel;
      }
    }
  }catch(e){ console.log('[static] manifest check failed', e.message); }
  if(rel){ rel.checkedAt = now; await s.setJSON('release', rel); }
  return rel;
}

/** Serve one of the app's files. */
export async function serveStatic(req, ctx){
  const url = new URL(req.url); let path = url.pathname; if(path === '/') path = '/index.html';
  const rel = await currentRelease({refresh: path === '/index.html' && url.searchParams.has('refresh')});
  if(!rel) return new Response('The app files are not available yet (could not reach GitHub).', {status:503, headers:{'content-type':'text/plain; charset=utf-8'}});
  const f = rel.files[path]; if(!f) return new Response('Not found', {status:404, headers:{'content-type':'text/plain; charset=utf-8'}});
  const longLived = /^\/(icons\/|apple-touch-icon)/.test(path);
  const headers = {'content-type': f.type, 'etag': `"${f.hash}"`, 'cache-control': longLived ? 'public, max-age=86400' : 'no-cache', 'x-release': rel.built};
  if((req.headers.get('if-none-match') || '').includes(f.hash)) return new Response(null, {status:304, headers});
  const cache = caches.default; const key = new Request(`https://files.rudy-aya-ledger.invalid/${f.hash}`);
  const hit = await cache.match(key);
  if(hit) return new Response(hit.body, {status:200, headers});
  const s = store(); let bytes = null;
  const stored = await s.get('files/' + f.hash, {type:'json'}); if(stored) bytes = fromB64(stored);
  if(!bytes){
    const r = await fetch(raw('public' + path), {headers:{'user-agent':'rudy-aya-ledger'}});
    if(!r.ok) return new Response('Could not fetch ' + path + ' (' + r.status + ')', {status:502, headers:{'content-type':'text/plain; charset=utf-8'}});
    const got = new Uint8Array(await r.arrayBuffer());
    if(await hashOf(got) !== f.hash){
      // GitHub's cache has not caught up with the latest push yet: try the previous release's copy, else say so
      return new Response('The latest version of ' + path + ' is still propagating; try again in a minute.', {status:503, headers:{'content-type':'text/plain; charset=utf-8', 'retry-after':'60'}});
    }
    bytes = got; await s.setJSON('files/' + f.hash, toB64(bytes));
  }
  const res = new Response(bytes, {status:200, headers});
  if(ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, new Response(bytes, {headers:{'content-type': f.type, 'cache-control':'public, max-age=31536000'}})));
  return res;
}

export async function releaseInfo(){ const rel = await store().get('release', {type:'json'}); return rel ? {built: rel.built, since: rel.since, files: Object.keys(rel.files).length} : null; }
export { currentRelease };
