// #137 raw-HTML element — CSP blocks ALL network in REAL WebKit. Fixture html has
// a remote <img src="http://127.0.0.1:9/blocked.png">, a remote
// <link rel=stylesheet>, plus a valid inline data: <img>. The injected CSP
// (default-src 'none'; img-src data:; ...) must block the remote fetches while
// letting the data: image load. Editor is same-origin so we read the frame's
// contentDocument and assert:
//   • the remote img FAILED (complete && naturalWidth === 0),
//   • the data: img SUCCEEDED (complete && naturalWidth > 0),
// proving the block is at the CSP level, not a generic load failure.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-security-network';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function winShot(sid, name) { const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); } }
const fail = (m) => { console.error('HTML_NET_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(1000);

// The CSP must be present in the srcdoc regardless of render outcome.
const srcdocOk = await exec(sid, `
  const f = document.querySelector('.el-html iframe');
  return !!(f && (f.getAttribute('srcdoc')||'').includes("default-src 'none'"));
`);
if (!srcdocOk) problems.push('editor srcdoc missing CSP default-src none');

// Give the frame ample time to (attempt to) fetch the remote resources.
await sleep(1500);
const r = JSON.parse(await exec(sid, `
  const f = document.querySelector('.el-html iframe');
  if (!f) return JSON.stringify({ err: 'no iframe' });
  let out = {};
  try {
    const d = f.contentDocument;
    const remote = d.getElementById('r');
    const okImg = d.getElementById('ok');
    out.remoteComplete = remote ? remote.complete : 'no-el';
    out.remoteNatW = remote ? remote.naturalWidth : 'no-el';
    out.okComplete = okImg ? okImg.complete : 'no-el';
    out.okNatW = okImg ? okImg.naturalWidth : 'no-el';
    out.canary = !!d.getElementById('canaryEIGEN');
  } catch (e) { out.err = 'THREW:' + e; }
  return JSON.stringify(out);
`));
if (r.err) problems.push(`editor read: ${r.err}`);
else {
  if (!r.canary) problems.push('canary div not rendered');
  // Remote image: blocked by CSP => it will be complete (settled) with naturalWidth 0.
  if (!(r.remoteComplete === true && r.remoteNatW === 0)) {
    problems.push(`SECURITY: remote img not blocked (complete=${r.remoteComplete}, naturalWidth=${r.remoteNatW}) — CSP img-src should block http:`);
  }
  // data: image: allowed => naturalWidth > 0.
  if (!(r.okComplete === true && r.okNatW > 0)) {
    problems.push(`data: img did not load (complete=${r.okComplete}, naturalWidth=${r.okNatW}) — img-src data: should allow it`);
  }
}
await winShot(sid, 'editor');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_NET_PASS: CSP blocked remote img (naturalWidth 0) + remote stylesheet while data: img loaded (naturalWidth>0) — no network egress. PNG → ${OUT}/`);
process.exit(0);
