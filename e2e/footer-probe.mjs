// e2e: slide footer presence/absence + footerFont across the LIVE render paths
// (#135). Deck has slide 0 (footer shown) + slide 1 (omitFooter:true), with
// config.footerFont='shantell' and author/venue set. Verifies:
//   editor  (#1): footer present on slide 0 w/ Shantell font; absent on slide 1
//   present (#2): footer present on slide 0; absent on slide 1
//   HTML export (#4): exactly ONE .slide-footer div (slide 1 omitted) + Shantell CSS
// (Print/PDF path #5 is covered by exportMatrix unit tests — same builder.)
import { openApp, waitSeam, exec, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('FOOTER_FAIL:', m); process.exit(1); };

const footerInfo = (sid) => exec(sid, `
  const f = document.querySelector('.slide-footer');
  if (!f) return JSON.stringify({ present: false });
  const cs = getComputedStyle(f);
  return JSON.stringify({ present: true, font: cs.fontFamily, meta: (f.querySelector('.slide-footer-meta')||{}).textContent||'' });`);

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

// ---- Editor (#1) ----
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(300);
let f = JSON.parse(await footerInfo(sid));
if (!f.present) fail('editor slide 0: footer missing (should be shown)');
if (!/Shantell/i.test(f.font)) fail(`editor slide 0: footer font not Shantell: ${f.font}`);
if (!/Ada Lovelace/.test(f.meta)) fail(`editor slide 0: meta missing author: ${f.meta}`);
console.log('  editor slide 0: footer present, font=Shantell, meta ok ✓');

await exec(sid, "window.__eigendeck.store.getState().selectSlide(1);");
await sleep(300);
f = JSON.parse(await footerInfo(sid));
if (f.present) fail('editor slide 1: footer present (should be omitted)');
console.log('  editor slide 1 (omitFooter): footer absent ✓');

// ---- Present (#2) ----
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) { await sleep(250); if (await exec(sid, "return !!document.querySelector('.present-slide,.speaker-mode')")) break; }
await sleep(400);
f = JSON.parse(await footerInfo(sid));
if (!f.present) fail('present slide 0: footer missing');
if (!/Shantell/i.test(f.font)) fail(`present slide 0: footer font not Shantell: ${f.font}`);
console.log('  present slide 0: footer present, font=Shantell ✓');

await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await sleep(200);
await exec(sid, "window.__eigendeck.store.getState().selectSlide(1); window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) { await sleep(250); if (await exec(sid, "return !!document.querySelector('.present-slide,.speaker-mode')")) break; }
await sleep(400);
f = JSON.parse(await footerInfo(sid));
if (f.present) fail('present slide 1: footer present (should be omitted)');
console.log('  present slide 1 (omitFooter): footer absent ✓');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);").catch(() => {});

// ---- HTML export (#4) ----
const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
if (typeof html !== 'string' || html.startsWith('ERR:')) fail('export failed: ' + html);
// #109: the export embeds a print layer (a second slide copy behind @media print),
// which ALSO renders footers — so count per layer, not globally. Each layer must
// have exactly ONE footer (slide 0 shown, slide 1's omitFooter respected in BOTH
// the interactive screen render AND the print render).
const pIdx = html.indexOf('<div class="eig-print-layer">');
const screenHtml = pIdx >= 0 ? html.slice(0, pIdx) : html;
const printHtml = pIdx >= 0 ? html.slice(pIdx) : '';
const screenFooters = (screenHtml.match(/class="slide-footer"/g) || []).length;
if (screenFooters !== 1) fail(`HTML export screen layer: expected exactly 1 footer (slide 1 omitted), got ${screenFooters}`);
if (pIdx >= 0) {
  const printFooters = (printHtml.match(/class="slide-footer"/g) || []).length;
  if (printFooters !== 1) fail(`HTML export print layer: expected exactly 1 footer (slide 1 omitted), got ${printFooters}`);
}
if (!/\.slide-footer\s*\{[^}]*font-family:\s*'Shantell Sans'/.test(html)) fail('HTML export: .slide-footer CSS is not Shantell');
console.log(`  HTML export: 1 footer in screen layer${pIdx >= 0 ? ' + 1 in print layer' : ''} (slide 1 omitted) + Shantell CSS ✓`);

await quit(sid);
console.log('FOOTER_PASS: footer presence/absence + footerFont correct in editor, present, and HTML export');
process.exit(0);
