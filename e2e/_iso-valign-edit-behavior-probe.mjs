// Safety check: with the valign flex now on the edit contentEditable, can you still
// edit a bottom-aligned title normally? Enter edit, select-all, type, commit, verify.
import { openApp, waitSeam, exec, post, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK, ID = 'ttitle';
const CTRL=String.fromCharCode(0xE009), ESC=String.fromCharCode(0xE00C);
const fail = (m) => { console.error('VBEHAV_FAIL:', m); process.exit(1); };
const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open');
const perform = (a) => post(`/session/${sid}/actions`, { actions: a });
const release = () => fetch('http://127.0.0.1:4444/session/' + sid + '/actions', { method: 'DELETE' }).catch(() => {});
const center = JSON.parse(await exec(sid, `const n=document.querySelector('[data-element-id="${ID}"]');const r=n.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`));
// native double-click to edit
await perform([{ type:'pointer', id:'mouse', parameters:{pointerType:'mouse'}, actions:[
  {type:'pointerMove',duration:10,x:center.x,y:center.y,origin:'viewport'},
  {type:'pointerDown',button:0},{type:'pointerUp',button:0},{type:'pause',duration:30},
  {type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]); await release();
for (let i=0;i<25;i++){ await sleep(100); if (await exec(sid,`return !!document.querySelector('[data-element-id="${ID}"] [contenteditable="true"]')`)) break; }
// select-all (Ctrl+A now handled) + type a replacement
await perform([{type:'key',id:'k',actions:[{type:'keyDown',value:CTRL},{type:'keyDown',value:'a'},{type:'keyUp',value:'a'},{type:'keyUp',value:CTRL}]}]); await release();
await perform([{type:'key',id:'k',actions:'ZAP'.split('').flatMap(c=>[{type:'keyDown',value:c},{type:'keyUp',value:c}])}]); await release();
await sleep(150);
const live = await exec(sid, `const n=document.querySelector('[data-element-id="${ID}"] [contenteditable="true"]'); return n? n.textContent : '__NOCE__';`);
// commit via Escape
await perform([{type:'key',id:'k',actions:[{type:'keyDown',value:ESC},{type:'keyUp',value:ESC}]}]); await release();
await sleep(300);
const stored = await exec(sid, `const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='${ID}'); return e? (e.html||'').replace(/<[^>]+>/g,'') : '__GONE__';`);
await quit(sid);
console.log(`live-while-editing=${JSON.stringify(live)}  stored-after-commit=${JSON.stringify(stored)}`);
if (!/ZAP/.test(live)) fail(`typing did not register in the flex contentEditable (live=${JSON.stringify(live)})`);
if (!/ZAP/.test(stored)) fail(`edit did not commit to the store (stored=${JSON.stringify(stored)})`);
console.log('VBEHAV_PASS: editing a bottom-aligned box still types + commits with the valign flex');
process.exit(0);
