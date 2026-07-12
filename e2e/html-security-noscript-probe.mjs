// #137 raw-HTML element — NO-SCRIPT guarantee in REAL WebKit (jsdom cannot test
// this). The fixture html embeds a <script>window.__pwned=1</script>, an
// <img onerror="window.__pwned=1"> and an <svg><script>. Because the sandbox has
// NO allow-scripts, none of it may run. We assert, in the real browser:
//   • parent window.__pwned is undefined (nothing escaped the frame),
//   • the editor iframe is same-origin so its contentDocument is readable — the
//     canary <div> has NO data-ran / data-onerror attributes and the frame's
//     own window has no __pwned (script + inline handler never fired),
//   • the same holds in PRESENT MODE (locked sandbox="").
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-security-noscript';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function winShot(sid, name) { const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); } }
const fail = (m) => { console.error('HTML_SEC_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(1000);

// --- EDITOR (same-origin, contentDocument readable) --------------------------
const ed = JSON.parse(await exec(sid, `
  const f = document.querySelector('.el-html iframe');
  if (!f) return JSON.stringify({ err: 'no editor iframe' });
  let parentPwned = (typeof window.__pwned !== 'undefined');
  let framePwned = null, dataRan = null, dataOnerror = null, canary = null, sawScriptTag = null;
  try {
    const d = f.contentDocument, w = f.contentWindow;
    framePwned = (w && typeof w.__pwned !== 'undefined');
    const div = d && d.getElementById('payloadEIGEN');
    canary = !!div;
    dataRan = div ? div.getAttribute('data-ran') : 'no-div';
    dataOnerror = div ? div.getAttribute('data-onerror') : 'no-div';
    // The <script> text should be PRESENT in the DOM (inert), not executed.
    sawScriptTag = !!(d && d.querySelector('script'));
  } catch (e) { framePwned = 'THREW:' + e; }
  return JSON.stringify({ parentPwned, framePwned, dataRan, dataOnerror, canary, sawScriptTag });
`));
if (ed.err) problems.push(`editor: ${ed.err}`);
else {
  if (ed.parentPwned) problems.push('SECURITY: parent window.__pwned is set — script escaped the frame (editor)');
  if (ed.framePwned === true) problems.push('SECURITY: frame window.__pwned is set — <script> executed (editor)');
  if (typeof ed.framePwned === 'string') problems.push(`editor frame read threw: ${ed.framePwned}`);
  if (!ed.canary) problems.push('editor: canary div not found (markup did not render)');
  if (ed.dataRan === 'yes') problems.push('SECURITY: data-ran=yes — inline <script> executed (editor)');
  if (ed.dataOnerror === 'yes') problems.push('SECURITY: data-onerror=yes — img onerror handler fired (editor)');
}
await winShot(sid, 'editor');

// --- PRESENT MODE (locked sandbox="") ---------------------------------------
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().setPresenting(true);");
await sleep(1400);
const pr = JSON.parse(await exec(sid, `
  const f = document.querySelector('.present-slide iframe[title="HTML element"]');
  if (!f) return JSON.stringify({ err: 'no present iframe' });
  const sandbox = f.getAttribute('sandbox');
  const srcdoc = f.getAttribute('srcdoc') || '';
  let parentPwned = (typeof window.__pwned !== 'undefined');
  // Locked sandbox => cross-origin => contentDocument NOT readable. Assert that.
  let readable = false;
  try { readable = !!(f.contentDocument && f.contentDocument.body); } catch (e) { readable = 'THREW'; }
  return JSON.stringify({ sandbox, hasScriptTextInSrcdoc: srcdoc.includes('__pwned'), parentPwned, readable });
`));
if (pr.err) problems.push(`present: ${pr.err}`);
else {
  if (pr.sandbox !== '') problems.push(`present sandbox=${JSON.stringify(pr.sandbox)} (expected "" locked)`);
  if (pr.parentPwned) problems.push('SECURITY: parent window.__pwned set in present mode');
  // Locked sandbox is a unique opaque origin → parent cannot read contentDocument.
  if (pr.readable === true) problems.push('present iframe contentDocument readable (locked sandbox should make it opaque-origin)');
}
// NB: no /screenshot here — it HANGS in present mode (fullscreen compositing).
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);").catch(() => {});

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_SEC_PASS: no <script>/onerror executed (parent+frame __pwned unset, no data-ran/onerror) in editor AND present; present iframe locked (sandbox="", opaque origin). PNGs → ${OUT}/`);
process.exit(0);
