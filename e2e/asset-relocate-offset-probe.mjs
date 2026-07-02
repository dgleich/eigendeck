// #74 relocate-all-by-offset, driven through the REAL "Relocate…" button (the native
// file picker — the one WebDriver-blocked step — is stubbed via window.__eigendeckPickFile;
// see src/lib/filePicker.ts). No action seam: the real AssetSection.relocate handler runs
// (approve the picked file + offset-relocate the siblings). Also folds in the ledger-
// hygiene invariant (relocate REPLACES an asset's approval in place — old path dropped),
// which the retired asset-approval-cleanup probe used to cover via a seam.
//
//  S1: images/a.svg, images/b.svg, images/sub/c.svg → 3 linked assets, trust, save, quit.
//  move: delete images/, recreate the same tree under moved/images/ with NEW bytes.
//  S2: reopen → all 3 missing. Select asset 'ra', click Relocate… (picker → moved/a.svg)
//      → rb + rc auto-relocate by the same offset and read the NEW bytes; the ledger now
//      approves the 3 MOVED paths and NONE of the old images/ paths.
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { openApp, waitSeam, quit, exec, execA, sleep, trustAndWatchAllViaUI, trustReport } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK, HOME = dirname(DECK);
const fail = (m) => { console.error('RO_FAIL:', m); process.exit(1); };
const missing = (sid) => exec(sid, "try{return JSON.stringify(window.__eigendeck.missingAssets().map(m=>m.assetId).sort());}catch(e){return '[]';}");
const byteLen = (sid, id) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'${id}'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));`);
async function pollMissingGone(sid, id) { for (let i = 0; i < 20; i++) { await sleep(600); if (!JSON.parse(await missing(sid)).includes(id)) return true; } return false; }

// ---- S1: build the asset tree on disk + in the deck ----
mkdirSync(join(HOME, 'images', 'sub'), { recursive: true });
writeFileSync(join(HOME, 'images', 'a.svg'), '<svg></svg>');        // 11 bytes
writeFileSync(join(HOME, 'images', 'b.svg'), '<svg></svg>');        // 11
writeFileSync(join(HOME, 'images', 'sub', 'c.svg'), '<svg></svg>'); // 11
let sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('S1 open');
for (const [p, id] of [['images/a.svg', 'ra'], ['images/b.svg', 'rb'], ['images/sub/c.svg', 'rc']]) {
  const r = await execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${p}',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'${p}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
  if (r !== 'ok') fail('store ' + id + ': ' + r);
  await exec(sid, `window.__eigendeck.store.getState().addElement({id:'el-${id}',type:'image',assetId:'${id}',position:{x:100,y:100,width:200,height:200}});`);
}
if (!await trustAndWatchAllViaUI(sid)) fail('S1 trust+watch');    // trust + approve the 3 sources
if (await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('save');
await sleep(800); await quit(sid);
console.log('  S1: 3 linked assets under images/, trusted + saved');

// ---- move the whole folder, with NEW (longer) bytes to prove a real re-read ----
rmSync(join(HOME, 'images'), { recursive: true, force: true });
mkdirSync(join(HOME, 'moved', 'images', 'sub'), { recursive: true });
writeFileSync(join(HOME, 'moved', 'images', 'a.svg'), '<svg>AAAAA</svg>');   // 16 bytes
writeFileSync(join(HOME, 'moved', 'images', 'b.svg'), '<svg>BB</svg>');      // 13
writeFileSync(join(HOME, 'moved', 'images', 'sub', 'c.svg'), '<svg>CCC</svg>'); // 14

// ---- S2: reopen → all missing; relocate one via the REAL button; assert the rest follow ----
sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('S2 open');
await trustAndWatchAllViaUI(sid);   // re-establish trust this session; rescans (folder moved → all missing)
await sleep(3500);
let m = JSON.parse(await missing(sid));
if (!(m.includes('ra') && m.includes('rb') && m.includes('rc'))) fail('not all detected missing on reopen: ' + JSON.stringify(m));
console.log('  S2: all 3 detected missing after folder move ✓');

// Relocate ra through the REAL UI: select its element so its AssetSection (with the
// "Relocate…" button) shows, stub the next file-pick to the moved file, click Relocate.
const newAbs = join(HOME, 'moved', 'images', 'a.svg');
await exec(sid, "const s=window.__eigendeck.store.getState();if(!s.showProperties)s.toggleProperties();s.selectObject({type:'element',id:'el-ra'});s.setInspectorTab('element');");
await sleep(800);
await exec(sid, `window.__eigendeckPickFile = ${JSON.stringify(newAbs)};`);
if (!await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('Relocate'));if(b){b.click();return true;}return false;")) fail('no Relocate… button for ra');

// rb + rc should auto-relocate by the same offset and now hold the NEW bytes.
if (!await pollMissingGone(sid, 'ra')) fail('ra still missing after relocate');
if (!await pollMissingGone(sid, 'rb')) fail('rb still missing after offset relocate');
if (!await pollMissingGone(sid, 'rc')) fail('rc still missing after offset relocate');
const la = await byteLen(sid, 'ra'), lb = await byteLen(sid, 'rb'), lc = await byteLen(sid, 'rc');
if (la !== 16) fail(`ra did not re-read moved bytes (len=${la}, want 16)`);
if (lb !== 13) fail(`rb did not re-read moved bytes (len=${lb}, want 13)`);
if (lc !== 14) fail(`rc did not re-read moved bytes (len=${lc}, want 14)`);
console.log(`  relocate ra → ra=${la}B rb=${lb}B rc=${lc}B from the moved location ✓`);

// Ledger hygiene: approvals now point at the 3 MOVED paths, with NO orphaned images/ entries.
const appr = (await trustReport(sid)).ledgerApprovals || [];
if (appr.some((p) => p.includes('/images/') && !p.includes('/moved/'))) fail(`old images/ approval left orphaned: ${JSON.stringify(appr)}`);
if (!['moved/images/a.svg', 'moved/images/b.svg', 'moved/images/sub/c.svg'].every((s) => appr.some((p) => p.endsWith(s)))) fail(`moved paths not all approved: ${JSON.stringify(appr)}`);
console.log('  ledger approves the 3 moved paths; old images/ paths dropped in place ✓');

await quit(sid);
console.log('RO_PASS: one real relocate → folder offset relocates the rest; approvals replaced in place');
process.exit(0);
