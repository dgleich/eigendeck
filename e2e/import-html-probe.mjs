// #164 end-to-end: a real export -> Import-from-HTML round-trip preserves Unicode.
// Drives the actual pipeline (seam exportHtml -> seam importHtml = the real
// parseEigendeckSource decode -> db_import_json -> db_save_to_file -> reopen),
// bypassing only the native open/save-as file pickers. Exits non-zero on failure.
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
const sid = await openApp(process.env.E2E_APP, process.env.E2E_DECK);
if (!sid || !await waitSeam(sid)) { console.log('IMPORT_HTML FAIL: no seam'); process.exit(1); }
await sleep(1200);
const r = await exec(sid, `return (async()=>{
  const store = window.__eigendeck.store;
  const marker = "λΣ∫− “q” café 你好 🎉 ∇²φ";
  const id = "uni-"+Date.now();
  store.getState().addElement({id, type:'text', preset:'body', html: marker, position:{x:100,y:100,width:600,height:100}});
  await new Promise(r=>setTimeout(r,150));
  const html = await window.__eigendeck.exportHtml();
  const hasEmbed = /id="eigendeck-deck"|<!-- eigendeck-source: /.test(html);
  await window.__eigendeck.importHtml(html, "/tmp/imported-uni-e2e.eigendeck");
  await new Promise(r=>setTimeout(r,300));
  const p = store.getState().presentation; // now the reopened SAVED deck
  let found = null;
  for (const sl of p.slides) for (const el of (sl.elements||[])) if (el.id===id) found = el.html;
  return { hasEmbed, markerOk: found===marker, foundSample: (found||'').slice(0,50) };
})()`);
await quit(sid);
const ok = r && r.hasEmbed && r.markerOk;
console.log('IMPORT_HTML ' + (ok ? 'PASS ' : 'FAIL ') + JSON.stringify(r));
process.exit(ok ? 0 : 1);
