// Exploratory workflow: place raster, SVG, and PDF files as a user would by
// pasting copied file URLs onto the real canvas. Then move/resize, save/reopen,
// and verify both the elements and embedded asset bytes/rendering survived.
import { copyFileSync, writeFileSync } from 'fs';
import { openApp, waitSeam, quit, exec, execA, sleep, dragElementToX } from './_ui.mjs';

const assetSettleMs = Number(process.env.E2E_ASSET_SETTLE_MS || 1400);

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const PDF_SOURCE = process.env.E2E_PDF;
const problems = [];
const bug = (message) => problems.push(message);
const fatal = (message) => { console.error('USER_ASSET_FATAL:', message); process.exit(1); };
const home = process.env.HOME || '/tmp';

const pngPath = `${home}/user-photo.png`;
const svgPath = `${home}/user-diagram.svg`;
const pdfPath = `${home}/user-paper.pdf`;
writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" rx="24" fill="#0f172a"/><circle cx="160" cy="180" r="90" fill="#22d3ee"/><path d="M250 180H540" stroke="#f8fafc" stroke-width="18"/><text x="285" y="145" fill="#f8fafc" font-family="sans-serif" font-size="42">Sparse solve</text><text x="285" y="210" fill="#a5f3fc" font-family="sans-serif" font-size="30">A x = b</text></svg>');
if (!PDF_SOURCE) fatal('set E2E_PDF to a readable PDF fixture');
copyFileSync(PDF_SOURCE, pdfPath);

const fileUrl = (path) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;

async function pasteFile(sid, path) {
  const before = Number(await exec(sid, `const s=window.__eigendeck.store.getState();return s.presentation.slides[s.currentSlideIndex].elements.filter(e=>e.type==='image').length;`));
  await exec(sid, `
    const dt=new DataTransfer();dt.setData('text/uri-list',${JSON.stringify(fileUrl(path))}+'\\r\\n');
    document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const raw = await exec(sid, `
      const s=window.__eigendeck.store.getState(),els=s.presentation.slides[s.currentSlideIndex].elements.filter(e=>e.type==='image');
      return els.length>${before}?JSON.stringify(els[els.length-1]):'';`);
    if (raw) return JSON.parse(raw);
  }
  return null;
}

async function resizeElement(sid, id, growW, growH) {
  return exec(sid, `
    const node=document.querySelector('[data-element-id=${JSON.stringify(id)}]');
    const handle=node&&node.querySelector('.el-resize-handle');
    const s=window.__eigendeck.store.getState(),el=s.presentation.slides[s.currentSlideIndex].elements.find(e=>e.id===${JSON.stringify(id)});
    if(!node||!handle||!el)return 'missing';
    node.click();const r=handle.getBoundingClientRect(),nr=node.getBoundingClientRect();
    const scale=nr.width/el.position.width,x=r.x+r.width/2,y=r.y+r.height/2;
    const opt=(cx,cy)=>({clientX:cx,clientY:cy,bubbles:true,pointerId:19,button:0});
    handle.dispatchEvent(new PointerEvent('pointerdown',opt(x,y)));
    window.dispatchEvent(new PointerEvent('pointermove',opt(x+${growW}*scale,y+${growH}*scale)));
    window.dispatchEvent(new PointerEvent('pointerup',opt(x+${growW}*scale,y+${growH}*scale)));
    const after=window.__eigendeck.store.getState().presentation.slides[window.__eigendeck.store.getState().currentSlideIndex].elements.find(e=>e.id===${JSON.stringify(id)});
    return JSON.stringify(after&&after.position);`);
}

async function addSlide(sid) {
  const clicked = await exec(sid, `const b=document.querySelector('.btn-add-slide');if(!b)return false;b.click();return true;`);
  if (!clicked) fatal('Add Slide button missing');
  await sleep(350);
}

async function assetSnapshot(sid) {
  return JSON.parse(await exec(sid, `
    const s=window.__eigendeck.store.getState();return JSON.stringify(s.presentation.slides.map(slide=>slide.elements.filter(e=>e.type==='image').map(e=>({id:e.id,assetId:e.assetId,kind:e.kind,position:e.position}))));`));
}

let sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fatal('could not open blank deck');
await exec(sid, `window.__assetErrors=[];addEventListener('error',e=>window.__assetErrors.push('error: '+e.message));addEventListener('unhandledrejection',e=>window.__assetErrors.push('rejection: '+String(e.reason)));`);

const png = await pasteFile(sid, pngPath);
if (!png || png.kind !== 'raster' || !png.assetId) bug(`PNG paste result: ${JSON.stringify(png)}`);
if (png) {
  await sleep(assetSettleMs); // default is human-scale; lower values stress in-flight flushes
  const x = await dragElementToX(sid, png.id, 120);
  if (typeof x !== 'number' || Math.abs(x - 120) > 2) bug(`PNG drag landed at ${x}`);
  const resized = JSON.parse(await resizeElement(sid, png.id, 240, 120));
  if (!resized || resized.width <= png.position.width || resized.height <= png.position.height) bug(`PNG resize failed: ${JSON.stringify(resized)}`);
}

await addSlide(sid);
const svg = await pasteFile(sid, svgPath);
if (!svg || svg.kind !== 'svg' || !svg.assetId) bug(`SVG paste result: ${JSON.stringify(svg)}`);
if (svg) {
  await sleep(assetSettleMs);
  const x = await dragElementToX(sid, svg.id, 300);
  if (typeof x !== 'number' || Math.abs(x - 300) > 2) bug(`SVG drag landed at ${x}`);
}

await addSlide(sid);
const pdf = await pasteFile(sid, pdfPath);
if (!pdf || pdf.kind !== 'pdf' || !pdf.assetId) bug(`PDF paste result: ${JSON.stringify(pdf)}`);
if (pdf) {
  await sleep(assetSettleMs);
  const x = await dragElementToX(sid, pdf.id, 480);
  if (typeof x !== 'number' || Math.abs(x - 480) > 2) bug(`PDF drag landed at ${x}`);
}

// Real rendered <img> nodes prove raster/SVG/PDF bytes traversed the frontend↔Rust
// render boundary. The PDF may take longer on its first Pdfium rasterization.
for (let i = 0; i < 40; i++) {
  const rendered = await exec(sid, `return !!document.querySelector('[data-element-id=${JSON.stringify(pdf?.id)}] img');`);
  if (rendered) break;
  if (i === 39) bug('PDF never rasterized into an editor image');
  await sleep(300);
}

await sleep(1800);
const live = await assetSnapshot(sid);
console.log('  live assets:', JSON.stringify(live));
const saved = await execA(sid, `const done=arguments[arguments.length-1];window.__eigendeck.save().then(()=>done('ok')).catch(e=>done('ERR: '+e));`);
if (saved !== 'ok') fatal(`save failed: ${saved}`);
const errors = JSON.parse(await exec(sid, `return JSON.stringify(window.__assetErrors||[])`));
await quit(sid);

sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fatal('could not reopen asset deck');
await sleep(1200);
const reopened = await assetSnapshot(sid);
console.log('  reopened assets:', JSON.stringify(reopened));
if (reopened.length !== 3 || reopened.some((slide) => slide.length !== 1)) bug(`unexpected reopened asset layout: ${JSON.stringify(reopened)}`);
for (const expected of [png, svg, pdf].filter(Boolean)) {
  const found = reopened.flat().find((e) => e.id === expected.id);
  if (!found || found.assetId !== expected.assetId || found.kind !== expected.kind) bug(`reopen lost ${expected.kind} identity: ${JSON.stringify(found)}`);
  const liveFound = live.flat().find((e) => e.id === expected.id);
  if (found && liveFound && ['x', 'y', 'width', 'height'].some((key) => found.position[key] !== liveFound.position[key])) {
    bug(`${expected.kind} geometry changed on reopen: live=${JSON.stringify(liveFound.position)} reopened=${JSON.stringify(found.position)}`);
  }
  const byteCount = await execA(sid, `const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:${JSON.stringify(expected.assetId)}}).then(b=>done(b.byteLength)).catch(e=>done('ERR: '+e));`);
  if (typeof byteCount !== 'number' || byteCount <= 0) bug(`${expected.kind} embedded bytes missing: ${byteCount}`);
}
await quit(sid);

if (errors.length) bug(`uncaught JavaScript errors: ${errors.join(' | ')}`);
if (problems.length) {
  console.error(`USER_ASSET_BUGS (${problems.length}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(2);
}
console.log('USER_ASSET_PASS: placed, moved, resized, rendered, saved, and reopened raster/SVG/PDF assets through the real app');
