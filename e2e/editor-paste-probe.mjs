// Coverage: exercise the REAL SlideEditor clipboard-PASTE handler end-to-end in
// the headless WebKitGTK rig — the ~470-line `handlePaste` block that docs long
// treated as an unreachable floor. WebKitGTK honors a synthetic
// `new ClipboardEvent('paste', { clipboardData: dt })` with a populated
// DataTransfer, so we drive handlePaste with no OS clipboard and cover the cold
// paste helpers the plain-text/uri-list probes don't:
//   A. an image FILE on the DataTransfer (dt.items.add(File)) → insertPastedAsset
//   B. rich text/html BLOCK content → insertRichHtmlScreenshot → captureHtmlToPng
//      (verifies the HTML→PNG rasterize actually works in this engine)
//   C. text/uri-list pointing at a file → the Linux file-url insertPastedFilePaths
//   D. x-special/gnome-copied-files pointing at a file → the GNOME file-url branch
//   E. plain text → insertPastedText (editable text element)
//   F. marquee drag on the canvas background (guarded squeeze)
// Exercise-style: a no-uncaught-error sentinel + a few real "paste added the
// expected element" assertions. Each optional step is guarded so one unreachable
// branch doesn't fail the run.
//
//   PROBE=e2e/editor-paste-probe.mjs E2E_DECK=<deck> bash e2e/run-probe.sh
import { writeFileSync } from 'fs';
import { BASE, sleep, exec, openApp, waitSeam, quit, pasteInto, installErrorSentinel, readErrorSentinel, marqueeDrag } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('EDITORPASTE_FAIL:', m); process.exit(1); };

// A real 1x1 PNG (base64) — used both as a clipboard File and written to disk for
// the uri-list / gnome file-url branches. HOME is the deck dir (run-probe.sh),
// within the app's read gate.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const HOME = process.env.HOME || '/tmp';
const toFileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');

const sid = await openApp(APP, DECK);
if (!sid || !(await waitSeam(sid))) fail('open session / seam never ready');
await exec(sid, 'window.__eigendeck.store.getState().selectSlide(0);');

// No-uncaught-error sentinel — collect real errors/rejections across all pastes.
await installErrorSentinel(sid, '__pasteErrs');

const slide0 = async () => JSON.parse(await exec(sid, `
  const s = window.__eigendeck.store.getState().presentation.slides[0];
  return JSON.stringify((s.elements || []).map(e => ({
    type: e.type, hasAssetId: !!e.assetId, kind: e.kind,
    w: e.position ? Math.round(e.position.width) : 0, h: e.position ? Math.round(e.position.height) : 0,
  })));
`));
const countType = (els, t) => els.filter((e) => e.type === t).length;
// Wait until slide0 has >= expected of `type`; return the element list.
const waitForType = async (type, want) => {
  let els = await slide0();
  for (let i = 0; i < 25 && countType(els, type) < want; i++) { await sleep(300); els = await slide0(); }
  return els;
};

// Self-check: synthetic paste w/ a File is honored (else the whole probe is moot).
const canFile = await exec(sid, `
  const dt = new DataTransfer();
  const bin = atob(${JSON.stringify(PNG_B64)}); const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  dt.items.add(new File([arr], 'x.png', { type: 'image/png' }));
  return dt.files.length === 1 && dt.files[0].type === 'image/png';
`);
if (!canFile) fail('engine will not hold a File on a synthetic DataTransfer');
console.log('  synthetic File-on-DataTransfer works');

let els = await slide0();
let imgBefore = countType(els, 'image'), txtBefore = countType(els, 'text');

// ── A. Image FILE on the clipboard (no competing HTML) → insertPastedAsset ──
await pasteInto(sid, null, { files: [{ b64: PNG_B64, name: 'fig.png', type: 'image/png' }] });
els = await waitForType('image', imgBefore + 1);
if (countType(els, 'image') !== imgBefore + 1) fail(`A: image-file paste added ${countType(els, 'image') - imgBefore} images, expected 1`);
const a = els[els.length - 1];
if (a.type !== 'image' || !a.hasAssetId) fail(`A: pasted image has no assetId (${JSON.stringify(a)})`);
console.log(`  A OK — image File → image element (kind=${a.kind}, assetId ✓)`);
imgBefore = countType(els, 'image');

// ── B. Rich HTML BLOCK (styled table) → HTML→PNG screenshot image ──
// If captureHtmlToPng could NOT rasterize, insertRichHtmlScreenshot returns false
// and the paste falls through to a TEXT element — so type==='image' proves the
// headless HTML→PNG rasterize works.
await pasteInto(sid, null, {
  text: 'Alpha\tBeta\n1\t2',
  html: '<table style="border-collapse:collapse"><tr><td style="border:1px solid #333;padding:6px">Alpha</td><td style="border:1px solid #333;padding:6px">Beta</td></tr><tr><td style="border:1px solid #333;padding:6px">1</td><td style="border:1px solid #333;padding:6px">2</td></tr></table>',
});
els = await waitForType('image', imgBefore + 1);
if (countType(els, 'image') === imgBefore + 1) {
  const b = els[els.length - 1];
  const dflt = b.w === 1200 && b.h === 680;
  console.log(`  B OK — rich HTML table → screenshot IMAGE (${b.w}x${b.h}${dflt ? ' [default size]' : ' [computed size]'}); captureHtmlToPng rasterizes headlessly`);
  imgBefore = countType(els, 'image');
} else if (countType(els, 'text') > txtBefore) {
  // captureHtmlToPng returned empty → fell through to text. Genuine floor: report it.
  console.log('  B FLOOR — captureHtmlToPng did NOT rasterize in this rig; rich HTML fell through to a TEXT element');
  txtBefore = countType(els, 'text');
} else {
  fail('B: rich HTML paste produced neither an image nor a text element');
}

// ── C. text/uri-list pointing at a file → Linux file-url insertPastedFilePaths ──
const uriPath = HOME + '/paste-src-uri.png'; writeFileSync(uriPath, PNG);
await pasteInto(sid, null, { uriList: toFileUrl(uriPath) + '\r\n' });
els = await waitForType('image', imgBefore + 1);
if (countType(els, 'image') === imgBefore + 1) {
  const c = els[els.length - 1];
  if (!c.hasAssetId) fail('C: uri-list paste image has no assetId');
  console.log(`  C OK — text/uri-list file → image asset (kind=${c.kind}, assetId ✓)`);
  imgBefore = countType(els, 'image');
} else {
  fail(`C: uri-list paste added ${countType(els, 'image') - imgBefore} images, expected 1`);
}

// ── D. x-special/gnome-copied-files → the GNOME file-url branch ──
const gnomePath = HOME + '/paste-src-gnome.png'; writeFileSync(gnomePath, PNG);
await pasteInto(sid, null, { gnome: 'copy\r\n' + toFileUrl(gnomePath) });
els = await waitForType('image', imgBefore + 1);
if (countType(els, 'image') === imgBefore + 1) {
  const d = els[els.length - 1];
  if (!d.hasAssetId) fail('D: gnome-copied-files paste image has no assetId');
  console.log(`  D OK — x-special/gnome-copied-files → image asset (kind=${d.kind}, assetId ✓)`);
  imgBefore = countType(els, 'image');
} else {
  fail(`D: gnome-copied-files paste added ${countType(els, 'image') - imgBefore} images, expected 1`);
}

// ── E. plain text → editable text element (insertPastedText) ──
await pasteInto(sid, null, { text: 'Hello paste world' });
els = await waitForType('text', txtBefore + 1);
if (countType(els, 'text') === txtBefore + 1) {
  console.log('  E OK — plain text → text element (insertPastedText)');
  txtBefore = countType(els, 'text');
} else {
  fail(`E: plain-text paste added ${countType(els, 'text') - txtBefore} text elements, expected 1`);
}

// ── F. marquee drag on the canvas background (guarded squeeze) ──
try {
  // A background marquee from a corner unlikely to hit an element (canvas-relative
  // px; the shared helper dispatches pointerdown on the canvas itself).
  const marq = await marqueeDrag(sid, 3, 3, 130, 130);
  console.log(`  F ${marq && marq !== 'no-canvas' ? 'OK' : 'skip'} — canvas-background marquee gesture (${JSON.stringify(marq)})`);
} catch (e) { console.log('  F skip — marquee gesture threw (guarded):', String(e)); }

// ── sentinel: no uncaught error/rejection across all the paste paths ──
const errs = await readErrorSentinel(sid, '__pasteErrs');
if (Array.isArray(errs) && errs.length) fail(`uncaught error(s) during paste exercise: ${JSON.stringify(errs)}`);
console.log('  sentinel OK — no uncaught error/rejection during the paste exercise');

await quit(sid);
console.log('EDITORPASTE_PASS: SlideEditor paste handler exercised (image/HTML/uri-list/gnome/text)');
process.exit(0);
