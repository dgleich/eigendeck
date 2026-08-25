// Deterministic repro for #185 (data loss: save after undo→redo of un-flushed
// structural edits persists a stale snapshot). Diagnostic — NOT in run-all's MANIFEST.
// Clean isolation with PRISTINE deck files (unique path per phase, no stale -wal).
// Compares the store state at save() time against the reopened state, with and
// without an undo/redo storm, to pin whether undo/redo corrupts persistence.
import { openApp, waitSeam, quit, exec, execA, sleep } from './_ui.mjs';
import { execSync } from 'child_process';
const APP = process.env.E2E_APP, CLI = process.env.E2E_CLI, EMPTY = process.env.EMPTY_JSON;
const mk = (p) => { for (const s of ['', '-wal', '-shm']) { try { execSync('rm -f "' + p + s + '"'); } catch {} } execSync(`"${CLI}" "${p}" import json "${EMPTY}"`); };

async function run(deck, n) {
  mk(deck);
  let sid = await openApp(APP, deck); if (!sid || !await waitSeam(sid)) return { err: 'open1' };
  await exec(sid, `const s=window.__eigendeck.store.getState(); s.selectSlide(0);
    s.addElement({id:'e1',type:'text',preset:'body',html:'hello',position:{x:10,y:10,width:200,height:60}});
    s.addSlide();`);
  if (n > 0) {
    await exec(sid, `const t=window.__eigendeck.store.temporal.getState(); for(let i=0;i<${n};i++)t.undo();`);
    await sleep(150);
    await exec(sid, `const t=window.__eigendeck.store.temporal.getState(); for(let i=0;i<${n};i++)t.redo();`);
    await sleep(150);
  }
  const atSave = await exec(sid, `const s=window.__eigendeck.store.getState();
    return JSON.stringify({slides:s.presentation.slides.length, s0els:s.presentation.slides[0].elements.length});`);
  const saved = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+String(e)));");
  await sleep(1000); await quit(sid);

  sid = await openApp(APP, deck); if (!sid || !await waitSeam(sid)) return { err: 'open2' };
  await sleep(600);
  const reopened = await exec(sid, `const s=window.__eigendeck.store.getState();
    return JSON.stringify({slides:s.presentation.slides.length, s0els:s.presentation.slides[0].elements.length});`);
  await quit(sid);
  return { saved, atSave: JSON.parse(atSave), reopened: JSON.parse(reopened) };
}

const ok = (r) => r.atSave && r.reopened && r.atSave.slides === r.reopened.slides && r.atSave.s0els === r.reopened.s0els;
const base = '/tmp/hunt/clean';
// history depth here is 2 undoable actions (addElement, addSlide).
for (const n of [0, 1, 2, 5]) {
  const r = await run(`${base}-n${n}.eigendeck`, n);
  console.log(`undo/redo x${n}  →  atSave=${JSON.stringify(r.atSave)}  reopened=${JSON.stringify(r.reopened)}  faithful=${ok(r)}`);
}
process.exit(0);
