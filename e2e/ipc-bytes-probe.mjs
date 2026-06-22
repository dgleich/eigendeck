// Determine how Tauri 2.10 IPC accepts byte args for a Vec<u8> command, so we
// can replace the slow Array.from(bytes) path in db_store_asset (issue #174).
// Invokes db_store_asset with three forms and reads each back to verify the
// bytes round-trip correctly:
//   arrayFrom   — Array.from(Uint8Array)  (current, slow)
//   uint8       — a Uint8Array directly
//   arraybuffer — an ArrayBuffer directly
// Env: E2E_APP (default /tmp/elrig/eigendeck), E2E_DECK (a .eigendeck).
const BASE = 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP || '/tmp/elrig/eigendeck';
const DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, j };
}
async function exec(sid, script) { const { j } = await post(`/session/${sid}/execute/sync`, { script, args: [] }); return j?.value; }
if (!DECK) { console.error('set E2E_DECK'); process.exit(2); }

let sid;
for (let i = 0; i < 12; i++) {
  try { const { j } = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) { sid = j.value.sessionId; break; } } catch {}
  await sleep(1000);
}
if (!sid) { console.error('NO SESSION'); process.exit(2); }

// wait for the DB/project to be ready
let ready = false;
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  const v = await exec(sid, `return (async()=>{ try { const id = await window.__TAURI_INTERNALS__.invoke('db_get_project_id'); return !!id; } catch(e){ return false; } })()`).catch(()=>false);
  if (v === true) { ready = true; break; }
}
if (!ready) { console.error('DB never became ready'); await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{}); process.exit(1); }

await exec(sid, `
  window.__ipc = null;
  (async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const EXPECT = '1,2,3,4,5';
    const mk = () => new Uint8Array([1,2,3,4,5]);
    const variants = { arrayFrom: Array.from(mk()), uint8: mk(), arraybuffer: mk().buffer };
    const out = {};
    for (const name of Object.keys(variants)) {
      try {
        const id = await inv('db_store_asset', { path: 'ipctest/'+name+'.bin', data: variants[name], mimeType: 'application/octet-stream', externalPath: null, externalMtime: null });
        let readback = 'n/a';
        try { const resp = await inv('db_get_asset_by_id', { assetId: id }); readback = Array.from(new Uint8Array(resp)).join(','); } catch (e) { readback = 'readback-err:'+e; }
        out[name] = { ok: true, correct: readback === EXPECT, readback };
      } catch (e) { out[name] = { ok: false, err: String(e).slice(0,160) }; }
    }
    window.__ipc = out;
  })();
  return 'started';
`);

let res = null;
for (let i = 0; i < 20; i++) { await sleep(1000); const v = await exec(sid, `return window.__ipc`); if (v) { res = v; break; } }
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (!res) { console.error('test never completed'); process.exit(1); }
console.log('IPC_BYTES_RESULT ' + JSON.stringify(res, null, 2));
