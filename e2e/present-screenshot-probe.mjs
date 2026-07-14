// Verify whether WebDriver GET /session/{id}/screenshot still HANGS in present
// mode (#134). Takes an editor-mode screenshot (control), enters present, then
// tries a present-mode screenshot with a hard timeout. If it returns, #134 is
// stale/fixed; if it times out, #134 is real.
import { openApp, waitSeam, exec, quit, BASE, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('PSHOT_FAIL:', m); process.exit(1); };

async function screenshot(sid, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(`${BASE}/session/${sid}/screenshot`, { signal: ac.signal });
    const j = await r.json();
    return { ok: true, len: (j.value || '').length, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 80), ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

const ed = await screenshot(sid, 15000);
console.log('editor screenshot:', ed.ok ? `OK (${ed.len} chars, ${ed.ms}ms)` : `FAILED (${ed.err}, ${ed.ms}ms)`);

await exec(sid, "window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().setPresenting(true);");
let inPresent = false;
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide,.speaker-mode')")) { inPresent = true; break; } }
if (!inPresent) fail('did not enter present mode');
await sleep(600);

const pr = await screenshot(sid, 20000);
console.log('present screenshot:', pr.ok ? `OK (${pr.len} chars, ${pr.ms}ms)` : `TIMED OUT/FAILED (${pr.err}, ${pr.ms}ms)`);

await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);").catch(() => {});
await quit(sid);

if (!pr.ok) { console.log('PSHOT_RESULT: present /screenshot still HANGS — #134 is REAL'); process.exit(2); }
console.log('PSHOT_RESULT: present /screenshot RETURNED — #134 appears STALE/FIXED'); process.exit(0);
