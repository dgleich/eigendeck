// e2e (#95): the editor shows a cut-off badge on text that overflows its box, and
// NOT on text that fits. jsdom can't measure scrollHeight, so this needs real WebKit.
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('OVERFLOW_FAIL:', m); process.exit(1); };
const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
// give the text SVG time to paint + the rAF overflow measurement to run
for (let i = 0; i < 20; i++) { await sleep(200); if (await exec(sid, `return !!document.querySelector('[data-element-id="t-overflow"] foreignObject')`)) break; }
await sleep(400);
const over = await exec(sid, `return !!document.querySelector('[data-element-id="t-overflow"] .text-overflow-badge')`);
const fit = await exec(sid, `return !!document.querySelector('[data-element-id="t-fit"] .text-overflow-badge')`);
console.log('  overflowing box badge:', over, ' | fitting box badge:', fit);
if (!over) fail('overflowing text has NO cut-off badge');
if (fit) fail('fitting text WRONGLY shows a cut-off badge');
await quit(sid);
console.log('OVERFLOW_PASS: cut-off badge shows for clipped text, absent when it fits');
process.exit(0);
