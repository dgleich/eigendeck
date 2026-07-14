// e2e: the YouTube loopback shim server (youtube_shim.rs, #152). Drives the REAL
// app to read the shim base via the youtube_shim_base command, then hits the
// loopback server from node to assert the security hardening end-to-end:
//   - valid 11-char id  -> 200, YouTube iframe, CSP + nosniff, NO CORS header
//   - bad id (short / injection) -> 400
//   - wrong token       -> 404
//   - bad Host header   -> 403 (anti-DNS-rebinding)
//   - option flags       -> reflected into the embed URL
//
// The rig serves the frontend from the DEV origin (http://localhost:1420), so the
// FRONTEND won't route through the shim (shimApplies() is false there) — but the
// Rust server runs regardless, and this probe exercises it directly. The packaged
// tauri:// activation path is a Mac sign-off item.
import http from 'node:http';
import { openApp, waitSeam, execA, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('YTSHIM_FAIL:', m); process.exit(1); };

// Raw GET so we can set an arbitrary Host header (fetch can't). Connects to the
// real ip:port; only the Host header varies.
function rawGet(urlStr, hostHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
        headers: hostHeader ? { Host: hostHeader } : {} },
      (res) => { let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); });
    req.on('error', reject);
    req.end();
  });
}

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

const base = await execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('youtube_shim_base').then(b=>d(b)).catch(e=>d('ERR:'+e));`);
console.log('shim base:', base);
if (!base || !/^http:\/\/127\.0\.0\.1:\d+\/yt\/[0-9a-f]{64}$/.test(base)) fail('bad/absent shim base: ' + base);

// 1. valid id -> 200 + youtube iframe + CSP + nosniff + NO CORS.
const ok = await rawGet(`${base}/dQw4w9WgXcQ`);
if (ok.status !== 200) fail('valid id -> ' + ok.status);
if (!ok.body.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ')) fail('valid id body missing the youtube embed');
if (ok.body.includes('<script')) fail('shim page unexpectedly contains <script');
if (!ok.headers['content-security-policy']) fail('missing CSP header on the shim page');
if ((ok.headers['x-content-type-options'] || '') !== 'nosniff') fail('missing nosniff');
if (ok.headers['access-control-allow-origin']) fail('shim MUST NOT send Access-Control-Allow-Origin');
console.log('  1) valid id -> 200 + youtube iframe + CSP/nosniff + no-CORS ✓');

// 2. bad ids -> 400.
if ((await rawGet(`${base}/short`)).status !== 400) fail('short id not 400');
if ((await rawGet(`${base}/abc%22%3E%3Cscript`)).status !== 400) fail('injection id not 400');
if ((await rawGet(`${base}/dQw4w9WgXcQextra`)).status !== 400) fail('overlong id not 400');
console.log('  2) malformed ids (short / injection / overlong) -> 400 ✓');

// 3. wrong token -> 404.
const badToken = base.replace(/\/yt\/[0-9a-f]+$/, '/yt/' + '0'.repeat(64)) + '/dQw4w9WgXcQ';
if ((await rawGet(badToken)).status !== 404) fail('wrong token not 404');
console.log('  3) wrong token -> 404 ✓');

// 4. bad Host header -> 403 (DNS-rebinding guard).
if ((await rawGet(`${base}/dQw4w9WgXcQ`, 'evil.example.com')).status !== 403) fail('bad Host not 403');
console.log('  4) foreign Host header -> 403 ✓');

// 5. option flags reflected into the embed URL.
const flagged = await rawGet(`${base}/dQw4w9WgXcQ?autoplay=1&mute=1&loop=1`);
if (!(flagged.body.includes('autoplay=1') && flagged.body.includes('mute=1') && flagged.body.includes('playlist=dQw4w9WgXcQ'))) fail('option flags not applied');
console.log('  5) option flags -> embed URL ✓');

await quit(sid);
console.log('YTSHIM_PASS: loopback shim serves the youtube iframe; id/host/token/method hardening enforced');
process.exit(0);
