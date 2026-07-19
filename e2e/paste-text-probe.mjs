// #161 e2e: paste plain/styled TEXT onto the canvas -> an editable text element.
// Drives the REAL app through the eigendeck-e2e rig, dispatching synthetic
// `paste` ClipboardEvents (WebKit lets us construct one with a populated
// DataTransfer) and asserting the store gains a correctly-sanitized text element.
//
//   PROBE=e2e/paste-text-probe.mjs E2E_DECK=<deck> bash e2e/run-probe.sh
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const fail = m => { console.error('FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('open session');
let ok = false;
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
if (!ok) fail('seam never ready');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");

// Self-check: can we even inject a synthetic paste with clipboard data in WebKit?
const inject = await exec(sid, `
  return new Promise((resolve) => {
    const h = (e) => { window.removeEventListener('paste', h, true); e.stopImmediatePropagation(); e.preventDefault(); resolve(e.clipboardData && e.clipboardData.getData('text/plain')); };
    window.addEventListener('paste', h, true);
    const dt = new DataTransfer(); dt.setData('text/plain', 'PROBE_PING');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    setTimeout(() => resolve('__timeout__'), 1500);
  });
`);
if (inject !== 'PROBE_PING') fail(`synthetic clipboard injection unsupported in this engine (got ${JSON.stringify(inject)})`);
console.log('  synthetic clipboard injection works');

const elsOnSlide0 = async () => exec(sid, `
  const s = window.__eigendeck.store.getState().presentation.slides[0];
  return (s.elements || []).map(e => ({ type: e.type, preset: e.preset, html: e.html || '' }));
`);
const dispatchPaste = async (plain, html) => exec(sid, `
  const dt = new DataTransfer();
  ${JSON.stringify(plain)} && dt.setData('text/plain', ${JSON.stringify(plain)});
  ${JSON.stringify(html)} && dt.setData('text/html', ${JSON.stringify(html)});
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return true;
`);
const waitForCount = async (n) => { for (let i = 0; i < 20; i++) { const els = await elsOnSlide0(); if (els.length >= n) return els; await sleep(300); } return await elsOnSlide0(); };

// --- Case A: styled text/html — strip a WHOLE-STRING color + font-size, keep bold ---
let base = (await elsOnSlide0()).length;
await dispatchPaste('Bold red', '<b style="color:#cc0000;font-size:44px">Bold red</b>');
let els = await waitForCount(base + 1);
if (els.length !== base + 1) fail(`case A: expected ${base + 1} elements, got ${els.length}`);
const a = els[els.length - 1];
if (a.type !== 'text') fail(`case A: new element is ${a.type}, not text`);
if (!a.html.includes('Bold red')) fail(`case A: text missing ("${a.html}")`);
if (/color/i.test(a.html)) fail(`case A: whole-string color NOT stripped ("${a.html}")`);
if (!/<(b|strong)|font-weight/i.test(a.html)) fail(`case A: bold not kept ("${a.html}")`);
if (/font-size|44px/i.test(a.html)) fail(`case A: font-size NOT stripped ("${a.html}")`);
console.log(`  case A OK — whole-string color + font-size dropped, bold kept: ${a.html}`);

// --- Case B: plain text only — newlines -> <br>, HTML metachars escaped ---
base = els.length;
await dispatchPaste('Line1\nLine2 <x> & y', '');
els = await waitForCount(base + 1);
if (els.length !== base + 1) fail(`case B: expected ${base + 1} elements, got ${els.length}`);
const b = els[els.length - 1];
if (b.type !== 'text') fail(`case B: new element is ${b.type}, not text`);
if (!b.html.includes('Line1<br>Line2')) fail(`case B: newline not converted ("${b.html}")`);
if (!b.html.includes('&lt;x&gt;') || !b.html.includes('&amp;')) fail(`case B: metachars not escaped ("${b.html}")`);
if (b.html.includes('<x>')) fail(`case B: raw tag leaked ("${b.html}")`);
console.log(`  case B OK — plain text -> text element, <br> + escaping: ${b.html}`);

// --- Case C: Word-style styled sentence wrapped in <p>/<div> — must become an
//     editable TEXT element, NOT a screenshot image (the reported regression) ---
base = els.length;
await dispatchPaste('Here is some bold text.', '<div><p>Here is <b style="color:#008000">some bold</b> text.</p></div>');
els = await waitForCount(base + 1);
if (els.length !== base + 1) fail(`case C: expected ${base + 1} elements, got ${els.length}`);
const c = els[els.length - 1];
if (c.type !== 'text') fail(`case C: Word <p> paragraph came in as ${c.type}, expected text (must not screenshot)`);
if (!/some bold/.test(c.html)) fail(`case C: text missing ("${c.html}")`);
if (!/<(b|strong)|font-weight/i.test(c.html) || !/color/i.test(c.html)) fail(`case C: bold/color not preserved ("${c.html}")`);
console.log(`  case C OK — Word <p> styled sentence -> TEXT element (not image): ${c.html}`);

// --- Case D: a real TABLE must screenshot to an IMAGE, not flatten to text ---
base = els.length;
await dispatchPaste('a\tb', '<table><tr><td>a</td><td>b</td></tr></table>');
els = await waitForCount(base + 1);
if (els.length !== base + 1) fail(`case D: expected ${base + 1} elements, got ${els.length}`);
const d = els[els.length - 1];
if (d.type !== 'image') fail(`case D: table came in as ${d.type}, expected image (screenshot)`);
console.log('  case D OK — table -> image (screenshot)');

// --- Case E: an eigendeck TEXT-RUN copy (marker, but NO element JSON) — e.g. you
//     copied part of a text while editing it — now creates a NEW text box with
//     the WebKit-baked whole-string color STRIPPED (theme), per Stages 2/3.
//     (Full element/slide copies carry the JSON and go through the private-flavor
//     path, never reaching here.) ---
base = els.length;
await dispatchPaste('white text', '<div data-eigendeck-copy="v1"><div style="color:#000000">white text</div></div>');
els = await waitForCount(base + 1);
if (els.length !== base + 1) fail(`case E: expected a new text box, got ${els.length - base} new element(s)`);
const eEl = els[els.length - 1];
if (eEl.type !== 'text') fail(`case E: new element is ${eEl.type}, expected text`);
if (!eEl.html.includes('white text')) fail(`case E: text missing ("${eEl.html}")`);
if (/color/i.test(eEl.html)) fail(`case E: baked whole-string color NOT stripped ("${eEl.html}")`);
console.log('  case E OK — eigendeck text-run → new text box, baked color stripped');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('E2E_PASS: paste-text (#161)');
process.exit(0);
