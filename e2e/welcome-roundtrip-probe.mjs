// Phase A (html-export-plan.md): an asset-heavy deck round-trips through HTML
// export->import WITH its assets. Drives the real seam exportHtml -> importHtml,
// then inspects the SAVED .eigendeck to assert asset FIDELITY (not just element
// refs — the original #153/import bug stripped bytes while leaving refs intact).
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
import { execFileSync } from 'node:child_process';
const OUT = '/tmp/imported-welcome-e2e.eigendeck';
const ORIG = process.env.E2E_DECK;
const sid = await openApp(process.env.E2E_APP, ORIG);
if (!sid || !await waitSeam(sid)) { console.log('WELCOME_RT FAIL: no seam'); process.exit(1); }
await sleep(1500);
const r = await exec(sid, `return (async()=>{
  const store = window.__eigendeck.store;
  const before = store.getState().presentation;
  const bEls = before.slides.reduce((a,s)=>a+(s.elements||[]).length,0);
  const html = await window.__eigendeck.exportHtml();
  const hasDeckBlock = /id="eigendeck-deck"/.test(html);
  await window.__eigendeck.importHtml(html, ${JSON.stringify(OUT)});
  await new Promise(r=>setTimeout(r,700));
  const after = store.getState().presentation;
  const aEls = after.slides.reduce((a,s)=>a+(s.elements||[]).length,0);
  return { hasDeckBlock, slidesOk: before.slides.length===after.slides.length, elsOk: bEls===aEls };
})()`);
await quit(sid);
// SQLite fidelity check on the SAVED file vs the original: same asset count,
// same total bytes, every asset-bearing element resolvable.
let assetCheck = { ok:false, err:'no-run' };
try {
  const py = `
import sqlite3,sys,json
def stat(f):
  c=sqlite3.connect(f).cursor()
  na=c.execute("select count(*) from assets where valid_to is null").fetchone()[0]
  tot=c.execute("select coalesce(sum(size),0) from assets where valid_to is null").fetchone()[0]
  rows=c.execute("select asset_id from elements where valid_to is null and asset_id is not null").fetchall()
  have=sum(1 for (a,) in rows if c.execute("select count(*) from assets where asset_id=? and valid_to is null",(a,)).fetchone()[0])
  return na,tot,have,len(rows)
o=stat(sys.argv[1]); i=stat(sys.argv[2])
print(json.dumps({"oAssets":o[0],"iAssets":i[0],"oBytes":o[1],"iBytes":i[1],"iResolvable":i[2],"iAssetEls":i[3],
  "ok": o[0]==i[0] and o[1]==i[1] and i[2]==i[3]}))`;
  const out = execFileSync('python3', ['-c', py, ORIG, OUT], { encoding:'utf-8' });
  assetCheck = JSON.parse(out.trim());
} catch (e) { assetCheck = { ok:false, err:String(e).slice(0,120) }; }
const ok = r && r.hasDeckBlock && r.slidesOk && r.elsOk && assetCheck.ok;
console.log('WELCOME_RT ' + (ok?'PASS ':'FAIL ') + JSON.stringify({ ...r, assets:assetCheck }));
process.exit(ok?0:1);
