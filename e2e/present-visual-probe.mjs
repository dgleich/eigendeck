// e2e (#134): present-mode VISUAL verification via the in-app seam capture,
// NOT the WebDriver GET /screenshot (which hangs in headless WebKitGTK once the
// app is presenting). Proves present renders real, non-blank pixels — the
// blank-present bug class (a 0x0 stage / missing content shows nothing).
import { openApp, waitSeam, exec, execA, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('PRESENT_VISUAL_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(500);

// Enter present mode and wait for the stage.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) {
  await sleep(300);
  if (await exec(sid, "return !!document.querySelector('.present-slide')")) break;
}
if (!await exec(sid, "return !!document.querySelector('.present-slide')")) fail('present stage never mounted');
await sleep(800); // let text SVG + cover paint

// Sanity: the stage must have real geometry (the #137 0x0-stage regression).
const rect = await exec(sid, `const r=document.querySelector('.present-slide').getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)};`);
console.log('  present stage rect:', JSON.stringify(rect));
if (!rect || rect.w < 50 || rect.h < 50) fail(`present stage collapsed (${rect?.w}x${rect?.h})`);

// Capture the present slide via the seam (domToDataUrl), then measure pixel
// content in-browser: a blank stage is a single flat color; real content has
// many distinct colors. Done with execA because captureElement is async.
const stats = await execA(sid, `
  const done = arguments[arguments.length - 1];
  (async () => {
    try {
      const url = await window.__eigendeck.captureElement('.present-slide');
      if (!url) return done({ err: 'captureElement returned null' });
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const W = c.width = Math.min(img.width, 400), H = c.height = Math.min(img.height, 260);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;
        const seen = new Set();
        for (let i = 0; i < data.length; i += 4) {
          // quantize to 4 bits/channel to count distinct-ish colors
          seen.add(((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4));
        }
        done({ dataUrlLen: url.length, imgW: img.width, imgH: img.height, distinctColors: seen.size });
      };
      img.onerror = () => done({ err: 'decode failed', dataUrlLen: url.length });
      img.src = url;
    } catch (e) { done({ err: String(e) }); }
  })();
`);
console.log('  seam capture stats:', JSON.stringify(stats));
if (!stats || stats.err) fail(`seam capture failed: ${stats?.err}`);
if (stats.imgW < 50 || stats.imgH < 50) fail(`captured image too small (${stats.imgW}x${stats.imgH})`);
// Blank present = a single flat colour. Title text (black) + white bg + blue
// cover → many distinct colours (anti-aliased glyph edges alone add dozens).
if (stats.distinctColors < 8) fail(`present looks blank — only ${stats.distinctColors} distinct colors`);

await quit(sid);
console.log(`PRESENT_VISUAL_PASS: present renders non-blank pixels (${stats.distinctColors} colors, ${stats.imgW}x${stats.imgH}) via seam capture`);
process.exit(0);
