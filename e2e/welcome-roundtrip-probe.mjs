// Phase A (html-export-plan.md): an asset-heavy deck round-trips through HTML
// export->import WITH its assets (images/demos/notebook restored, single-store).
// Drives the real seam exportHtml -> importHtml; asserts element + asset fidelity.
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
const OUT = '/tmp/imported-welcome-e2e.eigendeck';
const sid = await openApp(process.env.E2E_APP, process.env.E2E_DECK);
if (!sid || !await waitSeam(sid)) { console.log('WELCOME_RT FAIL: no seam'); process.exit(1); }
await sleep(1500);
const r = await exec(sid, `return (async()=>{
  const store = window.__eigendeck.store;
  const nAssetEls = (p)=>{ let n=0; for(const s of p.slides) for(const e of (s.elements||[])) if(e.assetId) n++; return n; };
  const before = store.getState().presentation;
  const bEls = before.slides.reduce((a,s)=>a+(s.elements||[]).length,0);
  const bAssetEls = nAssetEls(before);
  const html = await window.__eigendeck.exportHtml();
  const hasDeckBlock = /id="eigendeck-deck"/.test(html);
  await window.__eigendeck.importHtml(html, ${JSON.stringify(OUT)});
  await new Promise(r=>setTimeout(r,700));
  const after = store.getState().presentation;
  const aEls = after.slides.reduce((a,s)=>a+(s.elements||[]).length,0);
  const aAssetEls = nAssetEls(after);
  return { hasDeckBlock, slidesOk: before.slides.length===after.slides.length, elsOk: bEls===aEls, assetElsOk: bAssetEls===aAssetEls, bAssetEls, aAssetEls };
})()`);
await quit(sid);
const ok = r && r.hasDeckBlock && r.slidesOk && r.elsOk && r.assetElsOk && r.aAssetEls>0;
console.log('WELCOME_RT ' + (ok?'PASS ':'FAIL ') + JSON.stringify(r));
process.exit(ok?0:1);
