// E2E: the interactive-HTML export renders a notebook as full-fidelity
// scrollable HTML through the REAL invoke-backed pipeline — not the preview
// PNG, not the "NB" placeholder.
//
// This is the boundary that unit tests (mocked invoke) and the headless
// renderNotebookElementHtml test can't cover: fileOps.buildPresentationExportHtml
// → renderNotebookElement → getNotebookAssetBytes → invoke('db_get_asset_by_id')
// against the live SQLite, inside the actual WebKit webview.
//
// Drives window.__eigendeck.exportHtml() (dialog-free export builder). Env:
//   E2E_APP   app binary (default /tmp/elrig/eigendeck)
//   E2E_DECK  a .eigendeck containing a notebook element (the stress deck)
const BASE = 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP || '/tmp/elrig/eigendeck';
const DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}
async function exec(sid, script) {
  const { j } = await post(`/session/${sid}/execute/sync`, { script, args: [] });
  return j?.value;
}

if (!DECK) { console.error('set E2E_DECK'); process.exit(2); }

let sid;
for (let i = 0; i < 12; i++) {
  try {
    const { j } = await post('/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } },
    });
    if (j?.value?.sessionId) { sid = j.value.sessionId; break; }
  } catch { /* retry */ }
  await sleep(1000);
}
if (!sid) { console.error('NO SESSION'); process.exit(2); }

// 1. Wait for the deck + the seam to be ready, and confirm a notebook exists.
let nbCount = 0;
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  try {
    const v = await exec(sid, `
      const e = window.__eigendeck;
      if (!e || typeof e.exportHtml !== 'function') return { ready: false };
      const slides = e.store.getState().presentation.slides || [];
      let nb = 0;
      for (const s of slides) for (const el of (s.elements||[])) if (el.type === 'notebook') nb++;
      return { ready: slides.length > 0, slides: slides.length, nb };
    `);
    if (v?.ready) { nbCount = v.nb; break; }
  } catch { /* retry */ }
}
if (nbCount === 0) {
  console.error('FAIL: deck never loaded a notebook element');
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  process.exit(1);
}

// 2. Kick off the dialog-free export builder; stash the result on window.
await exec(sid, `
  window.__nbx = null;
  window.__eigendeck.exportHtml()
    .then((h) => { window.__nbx = h; })
    .catch((e) => { window.__nbx = 'ERR:' + (e && e.stack || e); });
  return 'started';
`);

// 3. Poll for completion, then compute assertions IN-PAGE (HTML is large).
let res = null;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const v = await exec(sid, `
    const h = window.__nbx;
    if (h == null) return { done: false };
    if (typeof h === 'string' && h.startsWith('ERR:')) return { done: true, err: h.slice(0, 800) };
    return {
      done: true,
      len: h.length,
      // The notebook rendered via renderNotebookElement → an iframe srcdoc
      // carrying the notebook stylesheet + cells.
      hasNbIframe: /<iframe srcdoc="[^"]*nb-body/.test(h),
      hasNbCell: h.includes('nb-cell'),
      // Real cell content from the stress deck's hello.ipynb.
      hasMarkdown: h.includes('Hello, eigendeck notebooks'),
      hasCode: h.includes('linspace'),
      // The fallback placeholder exportCore emits when the notebook is DROPPED
      // (renderNotebookElement returned null). Must be ABSENT.
      hasPlaceholder: /;">NB<\\/div>/.test(h) || h.includes('>NB</div>'),
    };
  `);
  if (v?.done) { res = v; break; }
}
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});

if (!res) { console.error('FAIL: export never completed'); process.exit(1); }
if (res.err) { console.error('FAIL: export threw\n' + res.err); process.exit(1); }

const ok = res.hasNbIframe && res.hasNbCell && res.hasMarkdown && res.hasCode && !res.hasPlaceholder;
console.error('export result:', JSON.stringify(res));
if (ok) {
  console.log(`E2E_PASS notebook rendered full-fidelity in export (len=${res.len})`);
  process.exit(0);
}
console.error('E2E_FAIL notebook not rendered as expected in export');
process.exit(1);
