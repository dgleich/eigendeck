// e2e: the screen-share PRESENTER window (#150) opens as a real 2nd Tauri window and
// renders the slide. This exercises the multi-window present path the a1-present-*
// probes deliberately dodge (they use single-window setPresenting) on the old — now
// disproven — belief that a 2nd window crashes WebKitWebDriver. It doesn't: the
// presenter window is drivable via WebDriver handles, and the main window survives.
import { openApp, waitSeam, handles, switchTo, findMainHandle, exec, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('PROJECTOR_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
const mainH = await findMainHandle(sid);

// Trigger the REAL screen-share present flow (opens the windowed presenter window).
await exec(sid, "window.dispatchEvent(new CustomEvent('eigendeck:screen-share-present'))");

let presH = null;
for (let i = 0; i < 15; i++) { await sleep(800); presH = (await handles(sid)).find((h) => h !== mainH); if (presH) break; }
if (!presH) fail('presenter window did not open (no 2nd window handle)');

// Switch into it; settle (a freshly-loaded 2nd webview reads empty for a beat), then
// assert it's the presenter and rendered the slide.
await switchTo(sid, presH);
let title = '', body = '';
for (let i = 0; i < 15; i++) { await sleep(500); title = String(await exec(sid, "return document.title||''")); body = String(await exec(sid, "return document.body?document.body.textContent:''")); if (title.includes('Presenter') && body.trim().length > 20) break; }
if (!title.includes('Presenter')) fail(`presenter title wrong; got: ${JSON.stringify(title)}`);
if (body.trim().length < 20) fail(`presenter rendered no slide content; got: ${JSON.stringify(body.slice(0, 80))}`);

// The main window must survive opening the 2nd window (the crash claim was stale).
await switchTo(sid, mainH);
if (!await exec(sid, "return !!window.__eigendeck")) fail('main window unreachable after opening the presenter window');

await quit(sid);
console.log('PROJECTOR_PASS: screen-share presenter window opens + renders the slide; main window still drivable');
process.exit(0);
