// e2e (#136): right-clicking each element type must open its context menu, even
// for the iframe/overlay types (html) whose overlay could swallow the event.
// Uses a REAL right-click (Actions API button:2) so iframe/overlay propagation is
// exercised faithfully — jsdom/synthetic events can't catch the swallow.
import { openApp, waitSeam, exec, post, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('CTXMENU_FAIL:', m); process.exit(1); };
const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(1500);

async function menuVisible() { return exec(sid, `return !!document.querySelector('.context-menu')`); }
async function dismiss() {
  // Close any open menu with Escape (never click UI chrome — a stray click on the
  // toolbar/sidebar can add/switch a slide and unmount the elements under test).
  await post(`/session/${sid}/actions`, { actions: [{ type:'key', id:'k', actions:[
    { type:'keyDown', value:'' }, { type:'keyUp', value:'' }]}]});
  await exec(sid, `window.dispatchEvent(new CustomEvent('context-menu-closed'));`);
  await sleep(150);
}
async function rightClick(id) {
  const r = await exec(sid, `const h=document.querySelector('[data-element-id="${id}"]'); if(!h) return null; const b=h.getBoundingClientRect(); return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)};`);
  if (!r) fail('element not found: ' + id);
  await post(`/session/${sid}/actions`, { actions: [{ type:'pointer', id:'m', parameters:{pointerType:'mouse'}, actions:[
    { type:'pointerMove', duration:0, x:r.x, y:r.y },
    { type:'pointerDown', button:2 }, { type:'pointerUp', button:2 }]}]});
  await sleep(400);
}

const results = {};
for (const id of ['e-text', 'e-cover', 'e-html']) {
  await dismiss();
  await rightClick(id);
  results[id] = await menuVisible();
  console.log(`  right-click ${id}: menu ${results[id] ? 'SHOWN' : 'MISSING'}`);
}
await dismiss();
await quit(sid);
const missing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) fail('no context menu for: ' + missing.join(', '));
console.log('CTXMENU_PASS: context menu opens for text, cover, and html (iframe) elements');
process.exit(0);
