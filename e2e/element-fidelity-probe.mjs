// Round-trip every element through HTML export->import and assert each element's
// FULL properties survive (text html/formatting, arrow geometry/heads/color, cover
// color, html source, positions, ...) — not just counts/assets. Matched by id.
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
const sid = await openApp(process.env.E2E_APP, process.env.E2E_DECK);
if (!sid || !await waitSeam(sid)) { console.log('ELFID FAIL: no seam'); process.exit(1); }
await sleep(1500);
const r = await exec(sid, `return (async()=>{
  const store = window.__eigendeck.store;
  function canon(v){ if(Array.isArray(v)) return '['+v.map(canon).join(',')+']';
    if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
    return JSON.stringify(v); }
  const grab = () => { const m={}; const p=store.getState().presentation;
    for(const s of p.slides) for(const e of (s.elements||[])) m[e.id]={type:e.type, c:canon(e), raw:e}; return m; };
  const before = grab();
  const html = await window.__eigendeck.exportHtml();
  await window.__eigendeck.importHtml(html, "/tmp/imported-elfid.eigendeck");
  await new Promise(r=>setTimeout(r,700));
  const after = grab();
  const bIds=Object.keys(before), aIds=Object.keys(after);
  const missing = bIds.filter(id=>!after[id]);
  const mism = [];
  for(const id of bIds){ if(after[id] && after[id].c!==before[id].c){
    // find changed keys
    const bk=before[id].raw, ak=after[id].raw||{};
    const keys=[...new Set([...Object.keys(bk),...Object.keys(ak)])];
    const diff=keys.filter(k=>canon(bk[k])!==canon(ak[k]));
    mism.push({id:id.slice(0,8), type:before[id].type, diff});
  }}
  const byType={}; for(const id of bIds){ const t=before[id].type; byType[t]=(byType[t]||0)+1; }
  return { total:bIds.length, byType, missing:missing.length, mismatchedCount:mism.length, mismatches:mism.slice(0,12) };
})()`);
await quit(sid);
const ok = r && r.missing===0 && r.mismatchedCount===0;
console.log('ELFID ' + (ok?'PASS ':'FAIL ') + JSON.stringify(r));
process.exit(ok?0:1);
