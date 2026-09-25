// Sync/link persistence BUG HUNT probe (2026-09-24). Confirms, on the REAL app
// (real store, real flush, real SQLite), the findings of src/store/syncHunt.test.ts.
//
// E2E_MODE picks one scenario (see SCENARIOS below). Each scenario drives real
// store actions / real copy+paste events / real Cmd+Z keydowns through the
// window.__eigendeck seam, saves (flush + save), QUITS, reopens in a new session,
// and compares the session against the reopened deck. Prints
//   SYNCHUNT <mode> REPRODUCED|CLEAN <details>
// and exits 0 either way (it's a hunt probe, not a gate); exits 1 only on rig
// failure. With E2E_EXPECT=clean it exits 1 when a finding reproduces.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const MODE = process.env.E2E_MODE || 'L1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function execSync(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execAsync(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await execSync(sid, 'return !!(window.__eigendeck&&window.__eigendeck.store&&window.__eigendeck.store.getState().projectPath)')) return true; } return false; }
async function quit(sid) { await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {}); }
const die = (m) => { console.error('SYNCHUNT_RIG_FAIL', MODE, m); process.exit(1); };

// Page-side helpers, prepended to every scenario body.
const H = `
const E=window.__eigendeck, s=E.store, st=()=>s.getState();
const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
const cur=()=>st().presentation.slides[st().currentSlideIndex];
const el=(i)=>cur().elements[i];
const key=(k,shift)=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,ctrlKey:true,shiftKey:!!shift,bubbles:true,cancelable:true}));
const undo=()=>key('z'); const redo=()=>key('z',true);
async function copyEl(i){ st().selectObject({type:'element',id:el(i).id}); await tick(); const d=new DataTransfer();
  document.body.dispatchEvent(new ClipboardEvent('copy',{clipboardData:d,bubbles:true,cancelable:true}));
  const h=d.getData('text/html'); if(!/data-eigendeck-json=/.test(h||'')) throw new Error('copy wrote no private flavor'); return h; }
async function paste(h){ st().selectObject({type:'slide'}); await tick(); const d=new DataTransfer(); d.setData('text/html',h);
  document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true})); await tick(300); }
const snap=()=>JSON.parse(JSON.stringify(st().presentation.slides.map(sl=>({id:sl.id,elements:sl.elements}))));
const newText=(id,x)=>({id,type:'text',preset:'textbox',html:'<div>'+id+'</div>',verticalAlign:'top',position:{x,y:100,width:300,height:100}});
`;

// Each scenario: fixture it expects + page-side body. `extra` is returned for printing.
const SCENARIOS = {
  // Class 1 — no session instance owns the group row
  L1: { fx: 'solo', note: 'dup slide, delete ORIGINAL slide, edit copy (flush after every step)', body: `
    st().duplicateSlide(0); await E.flush();
    st().deleteSlide(0); await E.flush();
    st().updateElement(el(0).id,{html:'<div>EDITED</div>'}); await E.flush();` },
  L3: { fx: 'solo', note: 'dup, delete ORIGINAL element, move copy', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().deleteElement(el(0).id); await E.flush();
    st().selectSlide(1); st().moveElementsBy([el(0).id],300,0); await E.flush();` },
  L4: { fx: 'solo', note: 'dup, delete ORIGINAL element, delete copy', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().deleteElement(el(0).id); await E.flush();
    st().selectSlide(1); st().deleteElement(el(0).id); await E.flush();` },
  L5: { fx: 'solo', note: 'dup, delete ORIGINAL element, bring the copy to front', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().deleteElement(el(0).id); await E.flush();
    st().selectSlide(1); st().moveElementZ(el(0).id,'top'); await E.flush();` },
  F2: { fx: 'solo', note: 'dup, free ORIGINAL, edit copy', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().freeElement(el(0).id); await tick(300);
    st().selectSlide(1); st().updateElement(el(0).id,{html:'<div>EDITED</div>'}); await E.flush();` },
  F3: { fx: 'solo', note: 'dup, free ORIGINAL, resync it, edit', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().freeElement(el(0).id); await tick(300);
    st().resyncElement(el(0).id); await tick(300);
    st().updateElement(el(0).id,{html:'<div>EDITED</div>'}); await E.flush();` },
  D1: { fx: 'solo', note: 'dup, move ORIGINAL, free it within the 1s debounce', body: `
    st().duplicateSlide(0); await E.flush();
    st().selectSlide(0); st().moveElementsBy([el(0).id],200,0);
    st().freeElement(el(0).id); await tick(500);` },
  // Class 2 — re-add of a persisted id
  C1: { fx: 'solo', note: 'delete element + Cmd+Z inside the debounce', body: `
    st().deleteElement(el(1).id); undo();` },
  C2: { fx: 'solo', note: 'delete slide + Cmd+Z inside the debounce', body: `
    st().deleteSlide(0); undo();` },
  C3: { fx: 'solo', note: 'delete element, flush, Cmd+Z', body: `
    st().deleteElement(el(1).id); await E.flush(); undo(); await E.flush();` },
  C4: { fx: 'solo', note: 'delete element, Cmd+Z, Cmd+Shift+Z inside the debounce', body: `
    st().deleteElement(el(1).id); undo(); redo();` },
  C5: { fx: 'solo', note: 'delete slide, Cmd+Z, Cmd+Shift+Z inside the debounce', body: `
    st().deleteSlide(1); undo(); redo();` },
  // Class 3 — per-instance state on one row / two instances of one row on one slide
  A1: { fx: 'syncgroup', note: 'unlink one synced instance (slide 2)', body: `
    st().selectSlide(1); st().unlinkElement(el(0).id); await tick(300);` },
  B1: { fx: 'syncgroup', note: 'copy synced G on slide 1, paste on slide 2 (already holds G)', body: `
    st().selectSlide(0); const h=await copyEl(0); st().selectSlide(1); await tick(); await paste(h);` },
  P1: { fx: 'solo', note: 'dup, copy synced copy, edit group, paste on empty slide', body: `
    st().duplicateSlide(0); await E.flush();
    const h=await copyEl(0);
    st().updateElement(el(0).id,{html:'<div>EDITED</div>'}); await E.flush();
    st().selectSlide(3); await tick(); await paste(h);
    extra.inSessionPasted = cur().elements.map(e=>e.html);` },
  R1: { fx: 'linked', note: 'add N on slide 1, link N->Q, promote N', body: `
    st().selectSlide(0); st().addElement(newText('N',400)); await tick();
    st().linkElements('N',1,'Q'); await tick(300);
    st().promoteToSync('N'); await tick(300);
    extra.slide0Ids = st().presentation.slides[0].elements.map(e=>e.id);` },
  // Class 4 — z_order
  Z2: { fx: 'solo', note: 'build slide, delete first element on it, add a text box (one debounce)', body: `
    st().addBuildSlide(); st().deleteElement(el(0).id); st().addElement(newText('NEW',250));` },
  // #191 shape — unsynced element comes back synced
  U1: { fx: 'solo', note: 'dup, copy the synced copy, Cmd+Z the dup, paste on slide 2', body: `
    st().duplicateSlide(0); await E.flush();
    const h=await copyEl(0); undo(); await tick(); await E.flush();
    st().selectSlide(1); await tick(); await paste(h);` },
  U2: { fx: 'solo', note: 'dup, free the copy, Cmd+Z, Cmd+Z quickly', body: `
    st().duplicateSlide(0); await E.flush(); await tick(400);   // > 200ms: its own undo step
    st().freeElement(el(0).id); await tick(400);
    undo(); undo();` },
  U3: { fx: 'solo', note: 'dup, copy the synced copy, delete the dup slide, paste on slide 2', body: `
    st().duplicateSlide(0); await E.flush();
    const h=await copyEl(0); st().deleteSlide(1); await E.flush();
    st().selectSlide(1); await tick(); await paste(h);` },
  // #191 original recollection, current code (sanity/coverage)
  DAV: { fx: 'solo', note: 'copy A, paste on slide 2 (link), dup slide 2, free on dup, paste again on slide 3', body: `
    st().selectSlide(0); const h=await copyEl(0);
    st().selectSlide(1); await tick(); await paste(h);
    st().duplicateSlide(1); await tick(300);
    const pasted = cur().elements.find(e=>e.syncId); st().freeElement(pasted.id); await tick(300);
    st().selectSlide(3); await tick(); await paste(h);` },
  // #191 recollection variants. FAST = all inside one 1s debounce; SLOW = 1.5s pauses
  // (a human pace: every step gets its own debounced flush under the old code).
  DAVF: { fx: 'solo', note: 'FAST: copy A, paste on slide 2 (link), dup slide 2, free the pasted copy on the dup, paste again on slide 3', body: `
    st().selectSlide(0); const h=await copyEl(0);
    st().selectSlide(1); await tick(); await paste(h);
    st().duplicateSlide(1); await tick(100);
    const p = cur().elements.find(e=>e.html.includes('A')); st().freeElement(p.id); await tick(100);
    st().selectSlide(3); await tick(); await paste(h);` },
  DAVS: { fx: 'solo', note: 'SLOW: same as DAVF with 1.5s pauses', body: `
    st().selectSlide(0); const h=await copyEl(0); await tick(1500);
    st().selectSlide(1); await tick(); await paste(h); await tick(1500);
    st().duplicateSlide(1); await tick(1500);
    const p = cur().elements.find(e=>e.html.includes('A')); st().freeElement(p.id); await tick(1500);
    st().selectSlide(3); await tick(); await paste(h); await tick(1500);` },
  DAV2F: { fx: 'solo', note: 'FAST: paste A on slide 2 (link), dup slide 2, copy the SYNCED copy, free it, paste the clip on slide 3', body: `
    st().selectSlide(0); const h=await copyEl(0);
    st().selectSlide(1); await tick(); await paste(h);
    st().duplicateSlide(1); await tick(100);
    const i = cur().elements.findIndex(e=>e.html.includes('A')); const h2=await copyEl(i);
    st().freeElement(el(i).id); await tick(100);
    st().selectSlide(3); await tick(); await paste(h2);` },
  DAV2S: { fx: 'solo', note: 'SLOW: DAV2F with 1.5s pauses', body: `
    st().selectSlide(0); const h=await copyEl(0); await tick(1500);
    st().selectSlide(1); await tick(); await paste(h); await tick(1500);
    st().duplicateSlide(1); await tick(1500);
    const i = cur().elements.findIndex(e=>e.html.includes('A')); const h2=await copyEl(i); await tick(1500);
    st().freeElement(el(i).id); await tick(1500);
    st().selectSlide(3); await tick(); await paste(h2); await tick(1500);` },
  FUR: { fx: 'syncgroup', note: 'FAST: free G on slide 2, Cmd+Z, Cmd+Shift+Z', body: `
    st().selectSlide(1); await tick(300); st().freeElement(el(0).id); await tick(300); undo(); redo();` },
  IDX: { fx: 'solo', note: 'duplicate the LAST slide, Cmd+Z: is currentSlideIndex still in range?', body: `
    st().selectSlide(2); await tick(300); st().duplicateSlide(2); await tick(400); undo(); await tick(200);
    extra.currentSlideIndex = st().currentSlideIndex; extra.slides = st().presentation.slides.length;` },
};

// ─── compare (same rules as the vitest harness) ─────────────────────────────
const IDK = ['id', 'syncId', '_syncId', 'linkId', '_linkId', 'src', 'demoSrc'];
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : (v && typeof v === 'object')
  ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);
const dataKey = (el) => { const o = { ...el }; for (const k of IDK) delete o[k]; return canon(o); };
const short = (e) => `${e.id}${e.syncId ? `~s:${e.syncId}` : ''}${e._syncId ? `~_s:${e._syncId}` : ''}${e.linkId ? `~l:${e.linkId}` : ''}(${(e.html || '').replace(/<[^>]+>/g, '')},${e.position?.x})`;
const summary = (slides) => slides.map((s, i) => `    [${i}] ${s.id.slice(0, 8)}: ${s.elements.map(short).join(' | ')}`).join('\n');
function partition(slides, keyOf) {
  const g = new Map();
  slides.forEach((s, i) => s.elements.forEach((el, j) => { const k = keyOf(el); if (!k) return; if (!g.has(k)) g.set(k, []); g.get(k).push(`${i}:${j}`); }));
  return [...g.values()].filter((x) => x.length > 1).map((x) => x.join(',')).sort().join(' / ');
}
function compare(S, R) {
  const out = [];
  if (S.map((s) => s.id).join() !== R.map((s) => s.id).join()) return [`slides session=${S.length} reopen=${R.length} (${R.map((s) => s.id.slice(0, 6)).join(',')})`];
  S.forEach((ss, i) => {
    const rs = R[i];
    const rUnsynced = rs.elements.filter((e) => !e.syncId).map(dataKey); const rSynced = new Set(rs.elements.filter((e) => e.syncId).map(dataKey));
    for (const se of ss.elements) { if (se.syncId) continue; const k = dataKey(se); const at = rUnsynced.indexOf(k); if (at >= 0) { rUnsynced.splice(at, 1); continue; } if (rSynced.has(k)) out.push(`unsynced-came-back-synced slide ${i} ${se.id}`); }
    if (ss.elements.length !== rs.elements.length) { out.push(`count slide ${i} session=${ss.elements.length} reopen=${rs.elements.length}`); return; }
    const sk = ss.elements.map(dataKey), rk = rs.elements.map(dataKey);
    if (sk.join('|') !== rk.join('|')) { out.push(([...sk].sort().join('|') === [...rk].sort().join('|')) ? `order slide ${i}` : `data slide ${i}`); return; }
    ss.elements.forEach((se, j) => { if ((se.linkId ?? null) !== (rs.elements[j].linkId ?? null)) out.push(`link slide ${i} el ${j} session=${se.linkId} reopen=${rs.elements[j].linkId}`); });
  });
  const sp = partition(S, (e) => e.syncId), rp = partition(R, (e) => e.id);
  if (sp !== rp) out.push(`sync session={${sp}} reopen={${rp}}`);
  return out;
}
function sessionInvariants(S) {
  const out = []; const by = new Map();
  for (const s of S) {
    const ids = s.elements.map((e) => e.id); if (new Set(ids).size !== ids.length) out.push(`session-dupid slide ${s.id.slice(0, 6)}`);
    for (const e of s.elements) if (e.syncId) { if (!by.has(e.syncId)) by.set(e.syncId, []); by.get(e.syncId).push(e); }
  }
  for (const [g, els] of by) if (els.length > 1 && new Set(els.map(dataKey)).size > 1) out.push(`session-syncdata group ${g}`);
  return out;
}
function dbCheck(path) {
  const py = `
import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
q=lambda s:c.execute(s).fetchall()
print('duprow',q("SELECT id,COUNT(*) FROM elements WHERE valid_to IS NULL GROUP BY id HAVING COUNT(*)>1"))
print('dupjunction',q("SELECT slide_id,element_id,COUNT(*) FROM slide_elements WHERE valid_to IS NULL GROUP BY 1,2 HAVING COUNT(*)>1"))
print('dupslide',q("SELECT id,COUNT(*) FROM slides WHERE valid_to IS NULL GROUP BY id HAVING COUNT(*)>1"))
print('junction-on-dead-slide',q("SELECT se.slide_id,se.element_id FROM slide_elements se WHERE se.valid_to IS NULL AND NOT EXISTS (SELECT 1 FROM slides s WHERE s.id=se.slide_id AND s.valid_to IS NULL)"))
print('dangling-junction',q("SELECT se.slide_id,se.element_id FROM slide_elements se WHERE se.valid_to IS NULL AND NOT EXISTS (SELECT 1 FROM elements e WHERE e.id=se.element_id AND e.valid_to IS NULL)"))
print('ztie',q("SELECT slide_id,z_order,COUNT(*) FROM slide_elements WHERE valid_to IS NULL GROUP BY 1,2 HAVING COUNT(*)>1"))
`;
  try { return execFileSync('python3', ['-c', py, path], { encoding: 'utf8' }).trim(); } catch (e) { return 'dbcheck failed: ' + e.message; }
}

// ─── WAL durability scenarios (separate flow) ───────────────────────────────
async function walScenario(sid) {
  // W1: free, wait (no Save), snapshot ONLY the main file (what a cloud sync / a copy without -wal sees).
  const what = MODE === 'W0' ? `st().selectSlide(0); st().moveElementsBy([el(1).id],50,0);`
    : MODE === 'W2' ? `st().selectSlide(1); st().freeElement(el(0).id); await tick(200); key('s');`
      : `st().selectSlide(1); st().freeElement(el(0).id);`;
  const r = await execAsync(sid, `const done=arguments[arguments.length-1];(async()=>{${H}${what}; done('ok');})().catch(e=>done('ERR:'+e));`);
  if (r !== 'ok') die('wal body: ' + r);
  await sleep(4000);   // well past the 1s debounce
  const main = DECK + '.mainonly';
  copyFileSync(DECK, main);
  const py = `
import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True)
print('junctions S1:',c.execute("select element_id from slide_elements where slide_id='S1' and valid_to is null").fetchall())
print('X on S0:',c.execute("select json_extract(data,'$.position.x') from elements where id='X' and valid_to is null").fetchall())
`;
  const out = execFileSync('python3', ['-c', py, main], { encoding: 'utf8' }).trim();
  console.log(`  main file (no -wal) while app still open, 4s after the action:\n${out.split('\n').map((l) => '    ' + l).join('\n')}`);
  console.log(`  -wal present: ${existsSync(DECK + '-wal')}`);
  const lines = out.split('\n');
  const reproduced = MODE === 'W0' ? !/550/.test(lines[1]) : /'G'/.test(lines[0]);
  console.log(`SYNCHUNT ${MODE} ${reproduced ? 'REPRODUCED' : 'CLEAN'} ${MODE === 'W0' ? '(control: debounced edit, expect X=550 in main file)' : 'freed instance still synced (junction to G) in the main file'}`);
  await quit(sid);
}

// ─── main ───────────────────────────────────────────────────────────────────
let sid = await open(); if (!sid || !await waitSeam(sid)) die('open');
await sleep(1000);
if (/^W\d$/.test(MODE)) { await walScenario(sid); process.exit(0); }
const sc = SCENARIOS[MODE]; if (!sc) die('unknown scenario');
console.log(`  scenario ${MODE} (${sc.fx}): ${sc.note}`);
const res = await execAsync(sid, `const done=arguments[arguments.length-1];(async()=>{${H}const extra={};${sc.body}
  await E.flush(); await E.save(); await tick(200);
  done(JSON.stringify({session:snap(), extra}));})().catch(e=>done('ERR:'+e+' '+(e&&e.stack)));`);
if (typeof res !== 'string' || res.startsWith('ERR')) die('body: ' + res);
const { session, extra } = JSON.parse(res);
await quit(sid); await sleep(2500);
const sid2 = await open(); if (!sid2 || !await waitSeam(sid2)) die('reopen');
await sleep(1200);
const reopened = JSON.parse(await execAsync(sid2, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_load_presentation').then(d).catch(e=>d('ERR:'+e));")).slides;
await quit(sid2); await sleep(1500);
const findings = [...sessionInvariants(session), ...compare(session, reopened)];
console.log(`  session:\n${summary(session)}\n  reopen:\n${summary(reopened)}`);
if (Object.keys(extra).length) console.log('  extra:', JSON.stringify(extra));
console.log('  db:', dbCheck(DECK).split('\n').join(' ; '));
console.log(`SYNCHUNT ${MODE} ${findings.length ? 'REPRODUCED' : 'CLEAN'} ${findings.join(' ; ')}`);
if (process.env.E2E_EXPECT === 'clean' && findings.length) process.exit(1);
process.exit(0);
