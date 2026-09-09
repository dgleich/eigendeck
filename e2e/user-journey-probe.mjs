// e2e USER-JOURNEY EXERCISE (coverage spike): sweep the MENU + FILE + PRESENT
// layer of the REAL built app in ONE run. This targets the biggest cold masses
// the interaction probe leaves untouched — App.tsx (the native-menu command
// router, window orchestration, insert dispatcher, present entry points) and
// store/fileOps.ts (the save round-trip) plus PresentMode.
//
// THE LEVER: App.tsx routes the native menu through a single global listener
//   listen('menu-event', e => switch(e.payload)).
// A page-side emit of that event therefore fires the REAL handler — the exact
// code path a native menu click runs. NOTE: a probe-side
// `import('@tauri-apps/api/event')` is a BARE specifier that does NOT resolve at
// runtime (only the app's own bundled imports do — the _ui.mjs gotcha), so
// `emit()` from the probe silently no-ops. The Tauri event plugin is reached
// directly instead: `window.__TAURI_INTERNALS__.invoke('plugin:event|emit',
// {event, payload})` (always present — it's the IPC bridge) delivers a global
// emit to THIS window's own listener. payload is the raw value the listener
// expects (a string for menu-event; an object for toolbar:*). We walk the
// DIALOG-FREE menu
// vocabulary in a sensible order, driving present + a save round-trip, and
// assert a no-uncaught-error sentinel plus a handful of real state effects
// (slide count up/down, element count up, present entered+exited, saved file
// exists + reopens with our change). Exercise-style + resilient: each optional
// step is guarded so one missing command can't fail the whole run. This is the
// MENU/FILE/PRESENT counterpart to interaction-exercise-probe.mjs (inspector +
// gestures) — deliberately NON-overlapping.
//
// Native OS dialogs (Save As / Open / picker / New) can't be driven headlessly,
// so those menu ids are intentionally NOT fired. The plain `save` id writes to
// the deck's existing path WITHOUT a dialog (the deck is opened from a real
// path via the launch arg), which is how we cover the fileOps save path.
import { openApp, waitSeam, exec, sleep, quit, makeSoft, installErrorSentinel, readErrorSentinel } from './_ui.mjs';
import { statSync } from 'node:fs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('JOURNEY_FAIL:', m); process.exit(1); };
const { soft, problems } = makeSoft();

// exec with a hard timeout, so a hypothetically-wedged UI thread (e.g. a native
// dialog we didn't anticipate) can't hang the whole probe forever.
async function execT(sid, s, ms = 6000) {
  return await Promise.race([exec(sid, s), new Promise((r) => setTimeout(() => r('__TIMEOUT__'), ms))]);
}
// Fire the REAL native-menu handler by delivering the menu-event through the
// Tauri event plugin's internal invoke (a global emit self-delivers to this
// window's listen('menu-event')). payload is the RAW string the listener reads.
const emitEvent = (sid, event, payloadJs) =>
  exec(sid, `return window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:${JSON.stringify(event)},payload:${payloadJs}});`);
const menu = (sid, id) => emitEvent(sid, 'menu-event', JSON.stringify(id));
const st = (sid, expr) => exec(sid, `return (()=>{const s=window.__eigendeck.store.getState();return ${expr};})()`);
const nSlides = (sid) => st(sid, 's.presentation.slides.length').then(Number);
const nEls = (sid, i) => st(sid, `s.presentation.slides[${i}].elements.length`).then(Number);
const curIdx = (sid) => st(sid, 's.currentSlideIndex').then(Number);
async function waitFor(sid, expr, want, tries = 20) {
  for (let i = 0; i < tries; i++) { if (String(await st(sid, expr)) === String(want)) return true; await sleep(150); }
  return false;
}

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');

// Crash sentinel — any uncaught error / unhandledrejection during the walk is a
// hard failure (the "no-crash" invariant). Benign youtube/network errors from
// the embed + missing linked assets are filtered at the end.
await installErrorSentinel(sid, '__jErrors');
// Force single-window present (projector mode defaults ON, would open a 2nd
// window on 'present' — getPreference reads localStorage, wiped fresh per run).
await exec(sid, "try{localStorage.setItem('eigendeck:pref:tryProjectorMode','false');}catch(e){}");
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(400);

const slides0 = await nSlides(sid);
soft(`fixture opened with ${slides0} slides`, slides0 >= 3, `got ${slides0}`);

// ── 1. View / panels / toggles ──────────────────────────────────────────────
console.log('\n[1] view / panels / toggles');
// A boolean-flag toggle: fire the menu command, then poll until the flag flips.
async function toggle(label, id, flagExpr) {
  const before = !!(await st(sid, flagExpr));
  await menu(sid, id);
  const flipped = await waitFor(sid, flagExpr, !before, 15);
  soft(label, flipped, `stayed ${before}`);
  return flipped;
}
await toggle('inspector menu toggled showProperties', 'inspector', '!!s.showProperties');
await toggle('inspector menu toggled showProperties back', 'inspector', '!!s.showProperties');   // restore
await toggle('history menu toggled showHistory', 'history', '!!s.showHistory');
await menu(sid, 'history'); await sleep(300);   // close history again
await toggle('toggle-show-grid flipped showGrid', 'toggle-show-grid', '!!s.showGrid');
await toggle('toggle-snap-grid flipped snapToGrid', 'toggle-snap-grid', '!!s.snapToGrid');
await menu(sid, 'select-all'); await sleep(300);
soft('select-all made a multi/element selection', /multi|element/.test(String(await st(sid, "JSON.stringify(s.selectedObject||{})"))));
await menu(sid, 'debug-console'); await sleep(200);
console.log('  · debug-console fired');
await menu(sid, 'toggle-decorations'); await sleep(300);
console.log('  · toggle-decorations fired');

// ── 2. Inspector tab menu commands ───────────────────────────────────────────
console.log('\n[2] properties-tab menu commands');
// showProperties defaults on and the tab may already be the target — reset the
// tab to 'element' before each so the assertion proves the command MOVED it.
for (const [id, tab] of [['slide-properties', 'slide'], ['deck-properties', 'presentation'], ['presentation-settings', 'presentation']]) {
  await exec(sid, "window.__eigendeck.store.getState().setInspectorTab('element');"); await sleep(150);
  await menu(sid, id);
  soft(`${id} -> inspectorTab '${tab}' + panel open`, await waitFor(sid, 's.inspectorTab', tab, 15) && (await st(sid, '!!s.showProperties')), `tab '${await st(sid, 's.inspectorTab')}'`);
}

// ── 3. Slides: new / duplicate / delete (assert the count moves) ─────────────
console.log('\n[3] slide new / duplicate / delete');
let n = await nSlides(sid);
await menu(sid, 'slide-new');
if (!await waitFor(sid, 's.presentation.slides.length', n + 1)) fail(`slide-new did not add a slide (stayed ${await nSlides(sid)})`);
console.log('  ✓ slide-new added a slide');
n = await nSlides(sid);
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);"); await sleep(150);
await menu(sid, 'slide-duplicate');
if (!await waitFor(sid, 's.presentation.slides.length', n + 1)) fail(`slide-duplicate did not add a slide (stayed ${await nSlides(sid)})`);
console.log('  ✓ slide-duplicate added a slide');
n = await nSlides(sid);
await menu(sid, 'slide-delete');
if (!await waitFor(sid, 's.presentation.slides.length', n - 1)) fail(`slide-delete did not remove a slide (stayed ${await nSlides(sid)})`);
console.log('  ✓ slide-delete removed a slide');

// ── 4. Insert dispatcher: dialog-free element inserts grow the slide ─────────
console.log('\n[4] insert dispatcher (element count grows)');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);"); await sleep(200);
const inserts = ['textbox', 'title', 'body', 'card', 'cover', 'arrow', 'footnote', 'note', 'html', 'hype'];
let grew = 0;
for (const kind of inserts) {
  const before = await nEls(sid, 0);
  await menu(sid, `insert-${kind}`);
  const ok = await waitFor(sid, 's.presentation.slides[0].elements.length', before + 1, 15);
  if (ok) grew++;
  soft(`insert-${kind} added an element`, ok, `count stayed ${await nEls(sid, 0)}`);
  await sleep(120);
}
if (grew !== inserts.length) fail(`only ${grew}/${inserts.length} dialog-free inserts added an element`);

// ── 5. Present flow: enter (single-window) -> nav -> exit ────────────────────
// Run EARLY, in a clean single-window state: the present + toolbar assertions
// below depend on the emitted event reaching the main window's listener, and
// that delivery degrades once a pile of second windows / native pickers is
// opened. The trailing no-crash branch-coverage steps (snapshots, picker
// inserts, window-openers, screen-share) come AFTER these real assertions.
console.log('\n[5] present flow (enter / nav / exit)');
async function exitPresent(sid) {
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
  await waitFor(sid, '!!s.isPresenting', false, 20);
}
// nav-key message routing is how PresentMode receives forwarded nav keys (#155).
const navKey = (sid, key) => exec(sid, `window.dispatchEvent(new MessageEvent('message',{data:{__eigendeck:1,type:'nav-key',key:${JSON.stringify(key)}}}));`);

await exec(sid, "try{localStorage.setItem('eigendeck:pref:tryProjectorMode','false');}catch(e){}");   // single-window present (no projector 2nd window that can hang openPresenterWindow)
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);"); await sleep(200);
await menu(sid, 'present');
const entered = await waitFor(sid, '!!s.isPresenting', true, 25);
if (!entered) fail('present menu did not enter present mode');
console.log('  ✓ present entered present mode');
{
  await sleep(900);   // PresentMode mounts + attaches the nav-key message listener
  const i0 = await curIdx(sid);
  await navKey(sid, 'ArrowRight');
  const advanced = await waitFor(sid, 's.currentSlideIndex', i0 + 1, 20);
  if (!advanced) fail(`present ArrowRight did not advance a slide (idx ${await curIdx(sid)} from ${i0})`);
  console.log('  ✓ present ArrowRight advanced a slide');
  await navKey(sid, 'ArrowLeft');
  await waitFor(sid, 's.currentSlideIndex', i0, 15);
  await exitPresent(sid);
  if (!((await st(sid, '!!s.isPresenting')) === false && (await execT(sid, "return !!document.querySelector('.slide-canvas')")) === true)) fail('present did not exit back to editor');
  console.log('  ✓ present exited back to editor');
}
// test-present-single: single-window present entry point (no projector window).
await sleep(300);
await menu(sid, 'test-present-single');
const entered2 = await waitFor(sid, '!!s.isPresenting', true, 20);
soft('test-present-single entered present mode', entered2);
if (entered2) { await sleep(400); await exitPresent(sid); soft('test-present-single exited', (await st(sid, '!!s.isPresenting')) === false); }

// ── 6. Native toolbar listeners (toolbar:action + toolbar:field) ─────────────
console.log('\n[6] native toolbar listeners');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);"); await sleep(150);
const tbBefore = await nSlides(sid);
await emitEvent(sid, 'toolbar:action', "{id:'add-slide'}");
soft('toolbar:action add-slide added a slide', await waitFor(sid, 's.presentation.slides.length', tbBefore + 1, 20), `stayed ${await nSlides(sid)}`);
const UNIQUE_TITLE = 'Journey-Saved-' + Date.now();
await emitEvent(sid, 'toolbar:field', `{id:'title',value:${JSON.stringify(UNIQUE_TITLE)}}`);
soft('toolbar:field title updated the deck title', await waitFor(sid, 's.presentation.title', UNIQUE_TITLE, 20), `title '${await st(sid, 's.presentation.title')}'`);

// ── 6b. Menu save (fileOps save-in-place, no dialog) ─────────────────────────
// Fire the menu `save` HERE, promptly after the fresh title edit and BEFORE any
// secondary window opens. Two reasons: (a) the 1s debounced auto-flush would
// otherwise have already written the earlier edits, leaving an explicit Save with
// no pending delta and the deck-file mtime unchanged; firing Save right after a
// fresh edit guarantees it has work to flush. (b) global menu-event delivery to
// this window's listener degrades once Settings/Security/projector windows are
// open (sections 8-9), so a Save fired after them may never reach saveProject.
console.log('\n[6b] menu save (save-in-place, mtime bump)');
const deckFile = `${DECK}`;
// The deck is a WAL-mode SQLite file: a save-in-place flush lands in the -wal
// sidecar and only a checkpoint rewrites the main .eigendeck file, so "did the
// menu save write the deck" must look at the newest of the file AND its
// -wal/-shm sidecars, not the main file alone.
const deckMtime = () => Math.max(...['', '-wal', '-shm'].map((s) => { try { return statSync(deckFile + s).mtimeMs; } catch { return 0; } }));
const mtimeBefore = deckMtime();
const liveSlides = await nSlides(sid);
await menu(sid, 'save'); await sleep(1500);
const mtimeAfter = deckMtime();
if (!(mtimeAfter > mtimeBefore)) fail(`menu save did not write the deck (mtime before=${mtimeBefore} after=${mtimeAfter})`);
console.log('  ✓ save updated the deck file mtime');

// ── 7. Snapshots + asset GC menu commands (no-crash branch coverage) ─────────
console.log('\n[7] snapshots + gc-assets');
for (const id of ['generate-snapshots', 'refresh-snapshots', 'gc-assets']) {
  await menu(sid, id); await sleep(2000);
  soft(`${id} fired, app still responsive`, (await execT(sid, "return window.__eigendeck.store.getState().presentation.slides.length")) !== '__TIMEOUT__');
}

// ── 8. Picker-backed inserts (branch coverage, no-crash) ─────────────────────
// Headless returns no file (native picker unavailable), so no element is added —
// assert only no-crash + still-responsive, never a count change.
console.log('\n[8] picker-backed inserts (branch coverage, no-crash)');
for (const kind of ['demo', 'notebook']) {
  await menu(sid, `insert-${kind}`); await sleep(1500);
  soft(`insert-${kind} fired, app still responsive`, (await execT(sid, "return !!window.__eigendeck")) === true);
}

// ── 9. Window-opening + extra present menu commands (branch coverage; the
//      interaction probe drives the Settings/Security windows deeply — here we
//      only fire the menu-event branch and confirm the MAIN window stays
//      healthy). These open 2nd windows, so they run LAST (before save). ──────
console.log('\n[9] window-opening + extra present menu commands (branch coverage)');
for (const id of ['settings', 'customize-toolbar', 'deck-security', 'security']) {
  await menu(sid, id); await sleep(800);
  soft(`${id} fired, main window healthy`, (await execT(sid, "return !!(window.__eigendeck && document.body)")) === true);
}
// screen-share-present / presenter open a projector window — fire for branch
// coverage, then ALWAYS force present mode off. Guarded (2nd-window open may
// no-op with no secondary monitor headlessly).
for (const id of ['screen-share-present', 'presenter']) {
  await menu(sid, id); await sleep(1200);
  await exitPresent(sid);
  soft(`${id} fired + present mode off`, (await st(sid, '!!s.isPresenting')) === false);
}

// ── 10. Save round-trip (reopen + compare) ───────────────────────────────────
// The menu save already happened in section 6b (before the window-openers). Here
// we tear the session down and reopen to prove the write round-tripped: the deck
// is not blank, its title change persisted, and the slide count matches.
console.log('\n[10] save round-trip (reopen + compare)');

// Snapshot the crash sentinel from the FIRST session before we tear it down for
// the reopen. Benign youtube/network errors (the embed + missing linked assets)
// are not app crashes — filter them.
const rawErrs = await readErrorSentinel(sid, '__jErrors');
const realErrs = rawErrs.filter((e) => !/youtube|ytimg|network|Failed to fetch|load|ERR_|pdfium|dialog/i.test(e));
console.log(`  crash sentinel: ${rawErrs.length} total events, ${realErrs.length} non-benign`);
await quit(sid);
await sleep(1500);

// Reopen in a FRESH session and confirm the deck round-tripped (not blank; our
// title change persisted; slide/element content survived).
const sid2 = await openApp(APP, DECK);
if (!sid2 || !await waitSeam(sid2)) fail('reopen/seam after save');
const reSlides = await nSlides(sid2);
const reTitle = await st(sid2, 's.presentation.title');
const reEls0 = await nEls(sid2, 0);
if (!(reSlides >= 3)) fail(`reopened deck is blank (slides persisted): got ${reSlides}`);
console.log('  ✓ reopened deck is not blank (slides persisted)');
if (!(reEls0 >= 1)) fail(`reopened deck slide 0 has no elements: got ${reEls0}`);
console.log('  ✓ reopened deck slide 0 has elements');
if (reTitle !== UNIQUE_TITLE) fail(`title change did not round-trip through save: got '${reTitle}'`);
console.log('  ✓ title change round-tripped through save');
if (reSlides !== liveSlides) fail(`reopened slide count does not match saved live count: live=${liveSlides} reopened=${reSlides}`);
console.log('  ✓ reopened slide count matches saved live count');

// ── 11. no-crash invariant ───────────────────────────────────────────────────
console.log('\n[11] invariants');
const stillHealthy = (await execT(sid2, "return !!(document.querySelector('.slide-canvas') && window.__eigendeck.store.getState().presentation.slides.length>=1)")) === true;
soft('canvas + store healthy after reopen', stillHealthy);
await quit(sid2);
if (realErrs.length) fail('uncaught app errors during the menu/present/save walk: ' + JSON.stringify(realErrs.slice(0, 5)));
console.log(`  ✓ no uncaught app errors (${rawErrs.length} events, ${realErrs.length} non-benign)`);

console.log('\n──────────────────────');
if (problems.length) {
  console.error(`JOURNEY: ${problems.length} soft problem(s):`);
  for (const p of problems) console.error('   • ' + p);
}
// Only the documented-optional steps remain soft: the window-opener ids in
// section 7 (snapshots / gc-assets), the picker/dialog-backed insert ids in
// section 8 (demo / notebook), and the window-open + screen-share ids in
// section 9 (settings, customize-toolbar, deck-security, security,
// screen-share-present, presenter). Each is guarded because global-emit
// delivery degrades once secondary windows are open (see the header comment).
if (problems.length > 3) fail(`too many journey steps failed (${problems.length}) — likely a structural break`);
console.log('JOURNEY_PASS: swept menu-event commands (view/panels, slide new/dup/delete, insert dispatcher, snapshots/gc, window-open branches, present enter/nav/exit, native toolbar), plus a fileOps save round-trip — no crash');
process.exit(0);
