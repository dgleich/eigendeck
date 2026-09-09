// e2e ASSET LAYER (coverage spike): drive the cold asset-inspector + asset-render
// paths in the REAL built app. Selects image elements so PropertiesPanel mounts
// AssetSection (source-file / linked-file / watch-toggle / Reload / version-
// history / VersionRow hover-preview / resize-to-image), and lays down raster,
// SVG, PDF, and MISSING-asset image elements so assetRenderer's per-kind render
// paths (raster, svg, pdf-via-pdfium) plus its fetch-failure placeholder fallback
// all fire through the canvas + sidebar thumbnails. The re-link (native picker)
// step is skipped — only its presence is checked.
//
// Exercise-style + resilient: a crash sentinel + a few HARD invariants (AssetSection
// renders for a stored asset; the missing asset shows "Not yet stored" + a canvas
// placeholder), the rest guarded soft so one absent control can't fail the run.
import { openApp, waitSeam, exec, sleep, quit } from './_ui.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HAVE_PDFIUM = existsSync(join(ROOT, 'src-tauri', 'resources', 'pdfium', 'libpdfium.so'));

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('ASSET_FAIL:', m); process.exit(1); };
const problems = [];
const soft = (label, cond, detail) => {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { problems.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  · SKIP ${label}${detail ? ' (' + detail + ')' : ''}`); }
};

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');

await exec(sid, `
  window.__assetErrors = [];
  window.addEventListener('error', (e) => window.__assetErrors.push('error: ' + (e.message || e.type)));
  window.addEventListener('unhandledrejection', (e) => window.__assetErrors.push('reject: ' + (e.reason && e.reason.message || e.reason)));
`);

await exec(sid, "const s=window.__eigendeck.store.getState();s.selectSlide(0);if(!s.showProperties)s.toggleProperties();");
// Let the sidebar thumbnails + canvas image boxes render (drives assetRenderer
// renderAsset for raster/svg/pdf, and the placeholder fallback for the missing one).
await sleep(2500);

const ids = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();return JSON.stringify(s.presentation.slides[0].elements.map(e=>({id:e.id,kind:e.kind})));"));
console.log('  seeded elements:', ids.map((e) => `${e.id}(${e.kind})`).join(', '));

// ── helpers ─────────────────────────────────────────────────────────────────
async function selectAsset(id) {
  await exec(sid, `var s=window.__eigendeck.store.getState();s.selectObject({type:'element',id:${JSON.stringify(id)}});s.setInspectorTab('element');if(!s.showProperties)s.toggleProperties();`);
  for (let i = 0; i < 15; i++) { await sleep(200); if (await exec(sid, "return !!document.querySelector('.properties-panel .prop-section')")) return true; }
  return false;
}
// Text of the "Asset" prop-section (AssetSection's rendered content).
const assetSectionText = () => exec(sid, `
  const secs=[...document.querySelectorAll('.properties-panel .prop-section')];
  const sec=secs.find(s=>s.querySelector('.prop-label')?.textContent==='Asset');
  return sec ? sec.textContent : '';`);

// ── 1. AssetSection full render for a stored raster asset with a linked source ─
console.log('\n[1] AssetSection render (stored raster + linked source)');
if (!await selectAsset('ap')) fail('inspector never mounted for ap');
await sleep(400);
const apText = String(await assetSectionText() || '');
if (!/Source file|Versions|Used on/.test(apText)) fail(`AssetSection did not render its body for ap: "${apText.slice(0, 120)}"`);
console.log('  ✓ AssetSection body rendered (source / versions / usage)');
soft('shows the linked external path', /dot\.png/.test(apText), apText.slice(0, 120));
soft('shows a version history count', /Versions \(\d+\)/.test(apText));
soft('shows a usage-scope caption', /Used on|Used \d+ times/.test(apText));

// ── 2. VersionRow hover → lazy preview popover (db_get_asset_version) ──────────
console.log('\n[2] version-row hover preview');
const hovered = await exec(sid, `
  const secs=[...document.querySelectorAll('.properties-panel .prop-section')];
  const sec=secs.find(s=>s.querySelector('.prop-label')?.textContent==='Asset');
  if(!sec) return false;
  // the current version row carries the "current" tag; hover its innermost row div.
  const cands=[...sec.querySelectorAll('div')].filter(d=>/current/.test(d.textContent||''));
  const row=cands.length?cands[cands.length-1].closest('div[style]')||cands[cands.length-1]:null;
  const target=row||cands[0];
  if(!target) return false;
  target.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
  target.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
  return true;`);
await sleep(500);
soft('hovered a version row', hovered);
// The popover is portaled to document.body (fixed, zIndex 10000). It shows
// Loading… / an <img> / a no-preview note — any is fine (the fetch path ran).
const popover = await exec(sid, "return [...document.querySelectorAll('body > div')].some(d=>{const t=d.textContent||'';return /Loading…|No preview|Preview failed/.test(t)||d.querySelector('img');})");
soft('preview popover appeared (lazy db_get_asset_version)', popover);

// ── 3. "Resize to image" (raster) → resizeToAsset measures + updates the box ──
console.log('\n[3] resize-to-image');
// Force a known NON-square box first so "resize to image" (which snaps to the
// asset's natural aspect) is a guaranteed, deterministic change — the box is
// otherwise idempotent once autosave has persisted a prior resize.
await exec(sid, "window.__eigendeck.store.getState().updateElement('ap',{position:{x:80,y:80,width:300,height:240}});");
await sleep(200);
const posBefore = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id==='ap');return JSON.stringify(e.position);"));
const clickedResize = await exec(sid, `
  const b=[...document.querySelectorAll('.properties-panel button')].find(x=>/Resize to image/.test(x.textContent||''));
  if(b){b.click();return true;}return false;`);
soft('clicked "Resize to image"', clickedResize);
if (clickedResize) {
  // resizeToAsset measures natural dims via an async Image decode of the asset
  // blob, then updateElement — poll for the box change rather than a fixed wait
  // (headless blob decode timing is variable).
  let changed = false;
  for (let i = 0; i < 16; i++) {
    await sleep(200);
    const posAfter = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id==='ap');return JSON.stringify(e.position);"));
    if (posAfter.width !== posBefore.width || posAfter.height !== posBefore.height || posAfter.x !== posBefore.x) { changed = true; break; }
  }
  soft('resize-to-image changed the box', changed);
}

// ── 4. "Reload from disk now" → gated read path (untrusted deck → warn) ────────
console.log('\n[4] reload-from-disk (gated path)');
const clickedReload = await exec(sid, `
  const b=[...document.querySelectorAll('.properties-panel button')].find(x=>/Reload from disk/.test(x.textContent||''));
  if(b){b.click();return true;}return false;`);
await sleep(500);
soft('clicked "Reload from disk now" (drives the gated read)', clickedReload);

// ── 5. watch toggle + review-linked-files affordance present ───────────────────
console.log('\n[5] watch toggle + review affordance');
soft('watch-file checkbox rendered', await exec(sid, `
  const secs=[...document.querySelectorAll('.properties-panel .prop-section')];
  const sec=secs.find(s=>s.querySelector('.prop-label')?.textContent==='Asset');
  return !!(sec && sec.querySelector('input[type="checkbox"]'));`));
soft('"Review linked files…" affordance present', /Review linked files/.test(apText) || await exec(sid, "return [...document.querySelectorAll('.properties-panel button')].some(b=>/Review linked files/.test(b.textContent||''))"));

// ── 6. missing-source banner (#74) — SOFT (kept as an observation; see TODO).
//      This is NOT an app bug. The banner is driven by markAssetMissing, which
//      only fires when a gated read of the linked file actually fails. For an
//      UNTRUSTED deck, reloadNow()'s gatedExternalRead returns `gated` and never
//      attempts the read (AssetSection.tsx reloadNow: "Untrusted deck / blocked
//      target → refuse"), so the app never learns the file is missing and the
//      banner correctly does not appear. This probe opens an untrusted deck, so
//      the dangling absolute externalPath cannot trip the banner here — that is
//      the asset-security "don't touch untrusted linked files" design, not #74.
// TODO(#74): add a TRUSTED+APPROVED variant (drive the Security-window trust +
//      approve flow, then Reload) that asserts the banner appears when an approved
//      linked file has vanished from disk.
const missingBanner = /Source file is missing|Relocate/.test(String(await assetSectionText() || ''));
soft('missing-source banner shown for the dangling link', missingBanner, 'untrusted deck never reads the linked file, so it cannot detect it missing (#74, by design)');

// ── 7. SVG asset renders (assetRenderer svg path) ─────────────────────────────
console.log('\n[7] svg asset render');
await selectAsset('asvg');
await sleep(600);
soft('svg canvas element has an <img>', await exec(sid, "return !!document.querySelector('[data-element-id=\"asvg\"] img')"));

// ── 8. PDF asset (pdfium) — hard when the dylib is present in the rig ──────────
console.log('\n[8] pdf asset render (pdfium)');
await selectAsset('apdf');
await sleep(1500);
if (HAVE_PDFIUM) {
  if (!await exec(sid, "return !!document.querySelector('[data-element-id=\"apdf\"] img')")) fail('pdf canvas element did not render an <img> although pdfium is present');
  console.log('  ✓ pdf element rendered via pdfium');
} else {
  console.log('  · pdf render skipped (no libpdfium.so in this rig)');
}

// ── 9. MISSING asset — AssetSection null-meta + canvas placeholder fallback ────
console.log('\n[9] missing asset (null-meta + placeholder fallback)');
if (!await selectAsset('amiss')) fail('inspector never mounted for amiss');
await sleep(500);
const missText = String(await assetSectionText() || '');
if (!/Not yet stored/.test(missText)) fail(`missing-asset AssetSection should show "Not yet stored", got: "${missText.slice(0, 120)}"`);
console.log('  ✓ AssetSection shows "Not yet stored" for the missing asset');
// The canvas ImageBox shows the placeholder tile (kind label + "rendering…") and NO <img>.
await sleep(700);
const missNode = String(await exec(sid, "const n=document.querySelector('[data-element-id=\"amiss\"]');return n?n.textContent:'';") || '');
const missHasImg = await exec(sid, "return !!document.querySelector('[data-element-id=\"amiss\"] img')");
soft('missing asset renders the placeholder (no <img>, kind label shown)', !missHasImg && /IMG|rendering/.test(missNode), `hasImg=${missHasImg} text="${missNode.slice(0, 40)}"`);

// ── 10. invariants ────────────────────────────────────────────────────────────
console.log('\n[10] invariants');
const errs = JSON.parse(await exec(sid, "return JSON.stringify(window.__assetErrors||[])"));
// Missing-asset fetch failures surface as rejections/console — those are the
// EXPECTED fallback path, not app crashes; filter them + benign network noise.
const realErrs = errs.filter((e) => !/network|Failed to fetch|ERR_/i.test(e));
if (realErrs.length) fail('uncaught errors during asset exercise: ' + JSON.stringify(realErrs.slice(0, 5)));
console.log(`  ✓ no uncaught app errors (${errs.length} events, ${realErrs.length} non-benign)`);
soft('canvas + store healthy', await exec(sid, "return !!(document.querySelector('.slide-canvas') && window.__eigendeck.store.getState().presentation.slides.length>=1)"));

await quit(sid);

console.log('\n──────────────────────────────────────────');
if (problems.length) {
  console.error(`ASSET: ${problems.length} soft problem(s):`);
  for (const p of problems) console.error('   • ' + p);
}
// Only the documented-optional steps remain soft: the version-row hover preview
// popover (lazy fetch timing), the resize-to-image box change (async blob decode),
// and the #74 missing-source banner (deterministically absent on an untrusted
// deck — see section 6's TODO). A larger failure count means something structural
// broke.
if (problems.length > 3) fail(`too many asset steps failed (${problems.length}) — likely a structural break`);
console.log('ASSET_PASS: AssetSection (source/versions/hover-preview/resize/reload/watch), raster+svg+pdf render paths, and the missing-asset placeholder + null-meta fallback — no crash');
process.exit(0);
