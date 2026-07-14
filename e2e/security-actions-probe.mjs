// Asset-security SPEC — the Security window's two-step model, driven through the REAL
// window (WebDriver window-handle switch + real button clicks), NOT an action seam.
// State is read back through the main-window trustReport OBSERVER, which also proves
// each approval propagated from the separate Security window to the main deck:
//
//   0. untrusted deck            → all linked files ELIGIBLE (approved:false)
//   1. before trust              → the window offers NO approve controls at all
//   2. Trust this deck           → trusted, but files STILL eligible (trust ≠ approve)
//   3. Approve a whole folder    → every eligible file in figs/ → APPROVED; other/ not
//   4. Approve one more file     → other/c.svg → APPROVED
//
// Needs an empty deck under HOME. Uses svg image assets (no media decode).
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { openApp, waitSeam, quit, handles, switchTo, exec, execA, sleep,
         trustReport, openSecurityWindow, clickButtonWithText, clickApproveInRow,
         clickApproveDir, hasApproveControls, waitForText } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK, HOME = dirname(DECK);
const fail = (m) => { console.error('SECURITY_ACTIONS_FAIL:', m); process.exit(1); };
const storeSvg = (sid, path, id) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'${path}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
const rowByExt = (rep, ext) => rep.rows.find((r) => r.ext === ext) || {};
// Read state from the MAIN observer (switch to main first).
async function state(sid, mainH) { await switchTo(sid, mainH); return await trustReport(sid); }
// Poll the MAIN observer until `pred(rep)` holds (approvals cross windows async).
async function waitState(sid, mainH, pred, tries = 15) {
  let rep = null;
  for (let i = 0; i < tries; i++) { rep = await state(sid, mainH); if (pred(rep)) return rep; await sleep(700); }
  return rep;
}

mkdirSync(join(HOME, 'figs'), { recursive: true });
mkdirSync(join(HOME, 'other'), { recursive: true });
writeFileSync(join(HOME, 'figs', 'a.svg'), '<svg></svg>');
writeFileSync(join(HOME, 'figs', 'b.svg'), '<svg></svg>');
writeFileSync(join(HOME, 'other', 'c.svg'), '<svg></svg>');

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open');
const mainH = (await handles(sid))[0];
for (const [p, id] of [['figs/a.svg', 'ia'], ['figs/b.svg', 'ib'], ['other/c.svg', 'ic']]) {
  if (await storeSvg(sid, p, id) !== 'ok') fail('store ' + id);
  await exec(sid, `window.__eigendeck.store.getState().addElement({id:'el-${id}',type:'image',assetId:'${id}',position:{x:60,y:60,width:150,height:150}});`);
}

// 0. untrusted → all eligible
let rep = await trustReport(sid);
if (rep.trusted) fail('deck should start untrusted');
if (!['figs/a.svg', 'figs/b.svg', 'other/c.svg'].every((e) => rowByExt(rep, e).approved === false)) fail(`expected all unapproved, got ${JSON.stringify(rep.rows.map((r) => [r.ext, r.approved]))}`);
console.log('  0) untrusted → all 3 files eligible ✓');

// Open the REAL Security window.
const secH = await openSecurityWindow(sid, mainH); if (!secH) fail('Security window did not open');
await switchTo(sid, secH);

// 1. before trust → the window offers NO approve controls (can't approve w/o trust)
if (await hasApproveControls(sid)) fail('approve controls present on an untrusted deck — must require trust first');
console.log('  1) before trust → window offers no approve controls (trust required) ✓');

// 2. click "Trust this deck" → trusted, but files STILL eligible (trust ≠ approve)
if (!await clickButtonWithText(sid, 'Trust this deck')) fail('no "Trust this deck" button');
for (let i = 0; i < 15; i++) { await sleep(700); if (!(await exec(sid, "return (document.body.textContent||'').includes('Trust this deck')"))) break; }
rep = await state(sid, mainH);
if (!rep.trusted) fail('deck did not become trusted after clicking Trust');
if (!['figs/a.svg', 'figs/b.svg', 'other/c.svg'].every((e) => rowByExt(rep, e).approved === false)) fail(`trust must approve NOTHING; got ${JSON.stringify(rep.rows.map((r) => [r.ext, r.approved]))}`);
console.log('  2) trust this deck → trusted, files still eligible (trust approves nothing) ✓');

// 3. approve the whole figs/ folder → ia+ib approved, ic (other/) still eligible
await switchTo(sid, secH);
if (!await waitForText(sid, 'Approve all')) fail('trusted view never rendered the folder-approve buttons');
if (!await clickApproveDir(sid, 'figs')) fail('no folder-approve button for the figs/ group');
rep = await waitState(sid, mainH, (r) => rowByExt(r, 'figs/a.svg').approved && rowByExt(r, 'figs/b.svg').approved);
if (!(rowByExt(rep, 'figs/a.svg').approved && rowByExt(rep, 'figs/b.svg').approved)) fail(`approve-folder did not approve both figs files; got ${JSON.stringify(rep.rows.map((r) => [r.ext, r.approved]))}`);
if (rowByExt(rep, 'other/c.svg').approved) fail('approve-folder leaked into other/ (c.svg should still be eligible)');
console.log('  3) approve folder figs/ → a.svg + b.svg approved; other/c.svg untouched ✓');

// 4. approve the remaining file individually
await switchTo(sid, secH);
if (!await clickApproveInRow(sid, 'c.svg')) fail('no per-row Approve button for c.svg');
rep = await waitState(sid, mainH, (r) => rowByExt(r, 'other/c.svg').approved);
if (!rowByExt(rep, 'other/c.svg').approved) fail('per-file approve did not approve c.svg');
console.log('  4) approve other/c.svg → approved ✓');

await quit(sid);
console.log('SECURITY_ACTIONS_PASS: two-step model holds — trust unlocks (approves nothing), then per-file / per-folder approve');
process.exit(0);
