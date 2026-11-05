// Builds what a direct API deploy needs: dist/worker.js (one bundled module) and dist/assets.json (the static-asset
// manifest: path → sha256-derived hash, size and content type). `npx wrangler deploy` does not need any of this.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'], outfile: 'dist/worker.js', logLevel: 'warning', legalComments: 'none' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const files = {};
(function walk(dir){ for(const name of readdirSync(dir)){ const p = join(dir, name); if(statSync(p).isDirectory()){ walk(p); continue; } if(name === '_headers' || name === '_redirects' || name === '.DS_Store') continue; const buf = readFileSync(p); const path = '/' + relative('public', p).split('\\').join('/'); files[path] = { hash: createHash('sha256').update(buf).digest('hex').slice(0, 32), size: buf.length, type: TYPES[extname(name).toLowerCase()] || 'application/octet-stream' }; } })('public');
writeFileSync('dist/assets.json', JSON.stringify({ built: new Date().toISOString(), files }, null, 1));
const size = statSync('dist/worker.js').size;
console.log(`dist/worker.js ${size} bytes · ${Object.keys(files).length} assets`);
