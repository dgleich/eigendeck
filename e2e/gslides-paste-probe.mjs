// e2e (#158): a Google Slides image paste (image embedded in text/html as an
// <img src="data:..."> inside a <b docs-internal-guid> wrapper, with NO image on
// the clipboard) inserts an image element. Synthetic paste event carrying only
// text/html — exactly what Google Slides puts on the clipboard.
import { openApp, waitSeam, exec, execA, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('GSLIDES_FAIL:', m); process.exit(1); };
const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(600);

const before = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;");
console.log('  image elements before:', before);

const added = await execA(sid, `
  const done = arguments[arguments.length - 1];
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const html = '<b id="docs-internal-guid-5400a67e-7fff-4cf0-ed00-dfea257517fc" style="font-weight: normal;"><img width="754px;" height="568px;" src="data:image/png;base64,' + PNG + '"></b>';
  try {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', '');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
  } catch (e) { return done({ err: 'dispatch: ' + String(e) }); }
  // poll the store for the new image element (asset store + addElement are async)
  let n = 0;
  const t = setInterval(() => {
    const els = window.__eigendeck.store.getState().presentation.slides[0].elements;
    const img = els.find(e => e.type === 'image');
    if (img || ++n > 40) { clearInterval(t); done({ count: els.length, hasImage: !!img, kind: img && img.kind }); }
  }, 150);
`);
console.log('  after paste:', JSON.stringify(added));
if (added && added.err) fail(added.err);
if (!added || !added.hasImage) fail('no image element added from the Google Slides HTML paste');
await quit(sid);
console.log('GSLIDES_PASS: Google Slides embedded-image paste inserted an image element');
process.exit(0);
