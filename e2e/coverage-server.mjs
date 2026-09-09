// E2E coverage collector server (spike). Drop-in replacement for
// `python3 -m http.server 1420 --directory dist` used by run-probe.sh when
// COVERAGE_INSTRUMENT=1: it serves dist/ statically AND accepts
//   POST /__coverage__?id=<id>
// writing the Istanbul map body to $COV_NYC_DIR/cov-<id>.json (overwrite → keep the
// latest cumulative snapshot per page, so re-posts never double-count). The
// instrumented app streams to it via src/lib/coverageBeacon.ts.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.COV_PORT || 1420);
const ROOT = resolve(process.env.COV_DIST || 'dist');
const NYC = resolve(process.env.COV_NYC_DIR || '.nyc_output');
await mkdir(NYC, { recursive: true });

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.png': 'image/png', '.map': 'application/json',
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/__coverage__') {
    const id = (u.searchParams.get('id') || 'anon').replace(/[^a-z0-9]/gi, '').slice(0, 64);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try { const buf = Buffer.concat(chunks); await writeFile(join(NYC, `cov-${id}.json`), buf); console.error(`[cov-server] POST cov-${id}.json (${buf.length}b)`); res.writeHead(204); res.end(); }
      catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    req.on('error', () => { res.writeHead(400); res.end(); });
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const fp = normalize(join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(fp)) { res.writeHead(404); res.end('not found'); return; }
  readFile(fp).then((data) => {
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  }).catch(() => { res.writeHead(500); res.end(); });
}).listen(PORT, '127.0.0.1', () => console.error(`[cov-server] :${PORT} root=${ROOT} nyc=${NYC}`));
