// Storage for the ledger: a handful of JSON documents (settings, accounts, months/YYYY-MM, moves/YYYY-MM, …) kept in one
// SQLite-backed Durable Object, so every read is strongly consistent and every write can be made conditional on the
// document's etag (the app's read-modify-write loop in ledger.mjs relies on that to never lose an entry when two phones
// or two bank alerts land at once).
//
// The Worker side (`store()`) talks to the object over RPC and presents the same tiny API the code used before
// (get / getWithMetadata / setJSON with onlyIfMatch|onlyIfNew / list / delete). Tests swap in `MemoryDocs`.

let runtime = { env: null, docs: null };

/** Called once per request by the Worker with its bindings; tests pass {env, docs: new MemoryDocs()}. */
export function bindRuntime(r){ runtime = { env: r.env || null, docs: r.docs || null }; }
export function envVar(name){
  const e = runtime.env; if(e && e[name] != null && e[name] !== '') return String(e[name]);
  try{ if(typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name]; }catch(e2){}
  return undefined;
}

function docs(){
  if(runtime.docs) return runtime.docs;
  const ns = runtime.env && runtime.env.LEDGER; if(!ns) throw new Error('Storage is not bound (LEDGER Durable Object missing).');
  return ns.get(ns.idFromName('main'));
}

export function store(){
  return {
    async get(key, {type}={}){ const r = await docs().get(key); if(!r) return null; return type==='json' ? JSON.parse(r.body) : r.body; },
    async getWithMetadata(key, {type}={}){ const r = await docs().get(key); if(!r) return null; return { data: type==='json' ? JSON.parse(r.body) : r.body, etag: r.etag, metadata: {} }; },
    async setJSON(key, data, opts={}){ return docs().set(key, JSON.stringify(data), { onlyIfMatch: opts.onlyIfMatch || null, onlyIfNew: !!opts.onlyIfNew }); },
    async list({prefix=''}={}){ const keys = await docs().list(prefix); return { blobs: keys.map(key => ({key})) }; },
    async delete(key){ await docs().delete(key); },
    async dump(){ return docs().dump(); },
    async load(entries){ return docs().load(entries); },
  };
}

const newEtag = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

/** The same document table in memory, for tests and local runs without a Durable Object. */
export class MemoryDocs {
  constructor(){ this.m = new Map(); }
  async get(key){ const r = this.m.get(key); return r ? {body:r.body, etag:r.etag} : null; }
  async set(key, body, opts={}){
    const cur = this.m.get(key);
    if(opts.onlyIfNew && cur) return {modified:false};
    if(opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return {modified:false};
    const etag = newEtag(); this.m.set(key, {body, etag, updated: Date.now()}); return {modified:true, etag};
  }
  async list(prefix){ return [...this.m.keys()].filter(k => k.startsWith(prefix)).sort(); }
  async delete(key){ this.m.delete(key); }
  async dump(){ return [...this.m.entries()].map(([key, r]) => ({key, body:r.body, updated:r.updated})); }
  async load(entries){ for(const e of entries) this.m.set(e.key, {body:e.body, etag:newEtag(), updated:e.updated||Date.now()}); return entries.length; }
}

/** Durable Object: one instance ("main") holds every document in its own SQLite database. */
export function defineLedgerStore(DurableObject){
  return class LedgerStore extends DurableObject {
    constructor(ctx, env){
      super(ctx, env); this.sql = ctx.storage.sql;
      this.sql.exec(`CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL, updated INTEGER NOT NULL)`);
    }
    get(key){ const r = this.sql.exec(`SELECT body, etag FROM docs WHERE key = ?`, key).toArray()[0]; return r ? {body:r.body, etag:r.etag} : null; }
    set(key, body, opts={}){
      const cur = this.get(key);
      if(opts.onlyIfNew && cur) return {modified:false};
      if(opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return {modified:false};
      const etag = newEtag();
      this.sql.exec(`INSERT INTO docs (key, body, etag, updated) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, etag = excluded.etag, updated = excluded.updated`, key, body, etag, Date.now());
      return {modified:true, etag};
    }
    list(prefix){ const like = String(prefix).replace(/[\\%_]/g, m => '\\' + m) + '%'; return this.sql.exec(`SELECT key FROM docs WHERE key LIKE ? ESCAPE '\\' ORDER BY key`, like).toArray().map(r => r.key); }
    delete(key){ this.sql.exec(`DELETE FROM docs WHERE key = ?`, key); }
    dump(){ return this.sql.exec(`SELECT key, body, updated FROM docs ORDER BY key`).toArray(); }
    load(entries){ const run = () => { let n = 0; for(const e of entries){ this.set(e.key, e.body); n++; } return n; }; return this.ctx.storage.transactionSync ? this.ctx.storage.transactionSync(run) : run(); }
  };
}
