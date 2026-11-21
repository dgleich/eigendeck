// e2e: the screen-share PRESENTER window (#150) opens as a real 2nd Tauri window and
// renders the slide. This exercises the multi-window present path the a1-present-*
// probes deliberately dodge (they use single-window setPresenting) on the old — now
// disproven — belief that a 2nd window crashes WebKitWebDriver. It doesn't: the
// presenter window is drivable via WebDriver handles, and the main window survives.
import { openApp, waitSeam, handles, switchTo, findMainHandle, exec, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('PROJECTOR_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
const mainH = await findMainHandle(sid);

// Keep the main window's console errors: a failed window creation is reported there
// (createAppWindow logs 'tauri://error'), and the failure message below includes them.
await exec(sid, "window.__errs = []; const o = console.error.bind(console); console.error = (...a) => { window.__errs.push(Math.round(performance.now() - (window.__t0 || 0)) + 'ms ' + a.map((x) => typeof x === 'string' ? x : x instanceof Error ? 'Error: ' + x.message : JSON.stringify(x)).join(' ')); o(...a); }; return 1;");
// Trigger the REAL screen-share present flow (opens the windowed presenter window).
await exec(sid, "window.__t0 = performance.now(); window.dispatchEvent(new CustomEvent('eigendeck:screen-share-present'))");
const t0 = Date.now();

let presH = null;
for (let i = 0; i < 15; i++) { await sleep(800); presH = (await handles(sid)).find((h) => h !== mainH); if (presH) break; }
console.log(`  2nd window handle after ${Date.now() - t0} ms`);
if (!presH) fail('presenter window did not open (no 2nd window handle)');
// Tauri's own view of its windows (labels), read from the main window: lets a failure
// tell "the window closed" apart from "WebDriver lost track of a live window" (#213).
const tauriWindows = () => execA(sid, `const done = arguments[arguments.length - 1];
  window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows').then((w) => done(JSON.stringify(w)), (e) => done('ERR ' + e));`);
const windowsAtOpen = await tauriWindows();
console.log('  tauri windows at open:', windowsAtOpen);

// Switch into it; settle (a freshly-loaded 2nd webview reads empty for a beat), then
// assert it's the presenter and rendered the slide.
const switched = await switchTo(sid, presH);
let title = '', body = '';
for (let i = 0; i < 15; i++) { await sleep(500); title = String(await exec(sid, "return document.title||''")); body = String(await exec(sid, "return document.body?document.body.textContent:''")); if (title.includes('Presenter') && body.trim().length > 20) break; }
if (!title.includes('Presenter')) {
  // Say WHY: did the switch itself fail, and what does each handle actually hold?
  const all = await handles(sid);
  const seen = [];
  for (const h of all) {
    const r = await switchTo(sid, h);
    const info = await exec(sid, "return JSON.stringify({ title: document.title, path: location.pathname, seam: !!window.__eigendeck })");
    seen.push(`${h === mainH ? 'main' : h === presH ? 'pres' : 'other'}:${JSON.stringify(r?.value ?? null)}:${info}`);
  }
  await switchTo(sid, mainH);
  const windowsAfter = await tauriWindows();
  const errs = await exec(sid, "return JSON.stringify(window.__errs || [])");
  fail(`presenter title wrong; got: ${JSON.stringify(title)}; tauri windows at open ${windowsAtOpen}, after ${windowsAfter}; main console errors ${errs}; switch response ${JSON.stringify(switched?.value ?? switched)}; handles ${JSON.stringify(all)}; per handle ${seen.join(' | ')}`);
}
if (body.trim().length < 20) fail(`presenter rendered no slide content; got: ${JSON.stringify(body.slice(0, 80))}`);

// The main window must survive opening the 2nd window (the crash claim was stale).
await switchTo(sid, mainH);
if (!await exec(sid, "return !!window.__eigendeck")) fail('main window unreachable after opening the presenter window');

await quit(sid);
console.log('PROJECTOR_PASS: screen-share presenter window opens + renders the slide; main window still drivable');
process.exit(0);
