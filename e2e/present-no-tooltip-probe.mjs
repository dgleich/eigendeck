// #203 guard in the REAL app: while presenting, the cursor is the presenter's pointer,
// so nothing inside the presenter may carry a `title` attribute or an SVG <title>
// element (WebKit draws either as a native tooltip on hover). The unit test
// (PresentSlide.tooltip.test.tsx) checks the element types one at a time; this checks
// the whole present screen as the app builds it. Deck: the printdemo fixture (a live
// demo, an html element, a notebook), plus a demo piece of that demo (which also
// mounts the hidden controller), a YouTube embed, and the static types (text, arrow,
// cover), all added to slide 0 before presenting.
import { openApp, waitSeam, exec, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('NO_TOOLTIP_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
await sleep(800);
const added = await exec(sid, `
  const s = window.__eigendeck.store.getState(); s.selectSlide(0);
  const demo = s.presentation.slides[0].elements.find((e) => e.type === 'demo');
  if (!demo) return 'NO_DEMO';
  const p = (x, y) => ({ x, y, width: 300, height: 200 });
  s.addElement({ id: 'tt-piece', type: 'demo-piece', assetId: demo.assetId, piece: 'main', position: p(1500, 40) });
  s.addElement({ id: 'tt-video', type: 'video', kind: 'embed', provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', position: p(1500, 300) });
  s.addElement({ id: 'tt-text', type: 'text', preset: 'title', html: 'Title', position: p(60, 860) });
  s.addElement({ id: 'tt-arrow', type: 'arrow', x1: 400, y1: 900, x2: 700, y2: 950, color: '#e53e3e', strokeWidth: 4, headSize: 16, heads: 'end', position: { x: 0, y: 0, width: 0, height: 0 } });
  s.addElement({ id: 'tt-cover', type: 'cover', color: '#222', position: p(800, 860) });
  return 'ok';`);
if (added !== 'ok') fail(`could not add elements: ${added}`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");

// Wait for the presenter to mount its iframes (demo, demo piece, controller, html, video).
let r = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  r = JSON.parse(await exec(sid, `
    const root = document.querySelector('.present-mode');
    if (!root) return JSON.stringify({ root: false });
    return JSON.stringify({ root: true,
      iframes: root.querySelectorAll('iframe').length,
      titled: [...root.querySelectorAll('[title], title')].map((n) => n.tagName.toLowerCase() === 'title'
        ? '<title>' + n.textContent + '</title>' : n.tagName.toLowerCase() + '[title="' + n.getAttribute('title') + '"]') });`));
  if (r.root && r.iframes >= 5) break;
}
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await quit(sid);

if (!r || !r.root) fail('present mode never mounted');
// Not vacuous: the iframe-backed elements (the tooltip source) must have rendered.
if (r.iframes < 5) fail(`only ${r.iframes} iframes in the presenter (expected demo, piece, controller, html, video)`);
if (r.titled.length) fail(`${r.titled.length} hover tooltip(s) in the presenter: ${r.titled.join(', ')}`);
console.log(`NO_TOOLTIP_PASS: ${r.iframes} iframes in the presenter, no title attributes or <title> elements`);
process.exit(0);
