// Toolbar-insert + Cmd+D duplication scoping (#182 / #183). Real WebKit, since the
// bugs are about DOM focus + keydown routing:
//   #182 — the "+ Hype" toolbar button was a dead no-op (runInsert had no case).
//   #183a — Shift+Cmd+D (Debug Console) also duplicated the selected slide.
//   #183b — Cmd+D after clicking into the editor duplicated the slide; it should
//           only duplicate when the slide picker (sidebar) actually holds focus.
import { openApp, waitSeam, exec, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('INSDUP_FAIL:', m); process.exit(1); };
const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

const nEls = async () => Number(await exec(sid, `const s=window.__eigendeck.store.getState(); return s.presentation.slides[s.currentSlideIndex].elements.length;`));
const nSlides = async () => Number(await exec(sid, `return window.__eigendeck.store.getState().presentation.slides.length;`));
// Dispatch from the FOCUSED element (like a real keypress) so e.target is a real
// element and bubbles to the window listener — dispatching on window makes
// e.target===window, which has no .closest and breaks the handler's guards.
const key = (o) => exec(sid, `(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, ...o })}));`);
// Select the current slide AND focus its sidebar thumbnail (what clicking a
// thumbnail does: selectSlide + focus).
const selectFocusSlide = () => exec(sid, `const s=window.__eigendeck.store.getState(); s.selectObject({type:'slide'}); const t=document.querySelector('.slide-thumbnail.active')||document.querySelector('.slide-thumbnail'); if(t){t.focus(); return document.activeElement===t;} return false;`);

// --- #182: '+ Hype' toolbar button adds an element ---
const e0 = await nEls();
const found = await exec(sid, `const b=[...document.querySelectorAll('button[title]')].find(x=>/Hype/i.test(x.getAttribute('title')||'')); if(b){b.click(); return true;} return false;`);
if (!found) fail('#182: could not find the "+ Hype" toolbar button');
await sleep(300);
const e1 = await nEls();
if (e1 !== e0 + 1) fail(`#182: + Hype did not add an element (${e0} -> ${e1})`);
console.log(`  #182: + Hype added an element (${e0} -> ${e1}) ✓`);

// --- #183a: Shift+Cmd+D must NOT duplicate a slide (only toggles the Debug Console) ---
if (!await selectFocusSlide()) fail('setup: could not select+focus a sidebar thumbnail');
const a0 = await nSlides();
await key({ key: 'd', metaKey: true, ctrlKey: true, shiftKey: true });
await sleep(300);
const a1 = await nSlides();
if (a1 !== a0) fail(`#183a: Shift+Cmd+D duplicated a slide (${a0} -> ${a1})`);
console.log(`  #183a: Shift+Cmd+D did NOT duplicate (${a0} slides) ✓`);

// --- #183b: Cmd+D duplicates when the sidebar holds focus ... ---
if (!await selectFocusSlide()) fail('setup: could not select+focus a sidebar thumbnail');
const b0 = await nSlides();
await key({ key: 'd', metaKey: true, ctrlKey: true });
await sleep(300);
const b1 = await nSlides();
if (b1 !== b0 + 1) fail(`#183b: Cmd+D with the sidebar focused did NOT duplicate (${b0} -> ${b1})`);
console.log(`  #183b: Cmd+D (sidebar focused) duplicated (${b0} -> ${b1}) ✓`);

// --- ... and NO-OPS once focus leaves the sidebar (as clicking the editor does) ---
// A 'slide' selection persists (clicking the editor canvas sets it), but focus is
// no longer in the sidebar, so Cmd+D must do nothing.
await exec(sid, `document.activeElement && document.activeElement.blur();`);
await sleep(100);
const inSidebar = await exec(sid, `return !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sidebar'));`);
if (inSidebar) fail('setup: focus still in sidebar after blur');
const c0 = await nSlides();
await key({ key: 'd', metaKey: true, ctrlKey: true });
await sleep(300);
const c1 = await nSlides();
if (c1 !== c0) fail(`#183b: Cmd+D after leaving the sidebar duplicated the slide (${c0} -> ${c1}) — should no-op`);
console.log(`  #183b: Cmd+D (focus outside the sidebar) did NOT duplicate (${c0} slides) ✓`);

await quit(sid);
console.log('INSDUP_PASS: + Hype inserts (#182); Cmd+D duplicate scoped to sidebar focus, ignores Shift (#183)');
process.exit(0);
