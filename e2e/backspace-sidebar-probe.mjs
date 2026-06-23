// Regression: Backspace must never reach the webview's default history-back
// (which navigated off the SPA and blanked the app — the reported "crash").
// Synthetic events can't invoke the native default, but we assert the proxy for
// it: the keydown is ALWAYS cancelled (preventDefault) outside text fields, the
// sidebar deletes its FOCUSED slide on Backspace, element delete still works, and
// the app/seam stays alive throughout.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('BKSP_FAIL:',m);process.exit(1);};
const nslides=(sid)=>exec(sid,"return window.__eigendeck.store.getState().presentation.slides.length");
const alive=(sid)=>exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store)");
// dispatch a cancelable Backspace on a selector; return whether default was prevented.
function bkspOn(sel){return `return (()=>{const el=${sel}; if(!el) return 'NO_EL'; if(el.focus) el.focus();
  const ev=new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true});
  const notCancelled=el.dispatchEvent(ev); return ev.defaultPrevented ? 'PREVENTED' : (notCancelled?'NOT_PREVENTED':'CANCELLED');})()`;}

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// --- Case A: Backspace on a focused sidebar thumbnail deletes that slide ----
await exec(sid,"var g=window.__eigendeck.store.getState; while(g().presentation.slides.length>1){g().deleteSlide(g().presentation.slides.length-1);} g().duplicateSlide(0);");
await sleep(300);
if(await nslides(sid)!==2) fail('setup: expected 2 slides');
await exec(sid,"window.__eigendeck.store.getState().selectSlide(1);");
await sleep(150);
const a=await exec(sid, bkspOn("document.querySelectorAll('.slide-thumbnail')[1]"));
await sleep(200);
if(a!=='PREVENTED') fail(`sidebar Backspace not prevented (got ${a}) — would trigger history-back`);
if(await nslides(sid)!==1) fail('sidebar Backspace did not delete the focused slide');
if(!await alive(sid)) fail('app/seam gone after sidebar Backspace (navigated away?)');
console.log('  Backspace on a focused thumbnail deletes that slide, default prevented ✓');

// --- Case B: Backspace with a slide selected but focus OUTSIDE the sidebar --
// must still be swallowed (preventDefault) but NOT delete a slide.
await exec(sid,"window.__eigendeck.store.getState().duplicateSlide(0);"); // back to 2
await sleep(200);
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0); document.body.focus(); if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();");
const before=await nslides(sid);
const b=await exec(sid, bkspOn("document.body"));
await sleep(200);
if(b==='NOT_PREVENTED') fail('Backspace on body NOT prevented — the history-back crash path');
if(await nslides(sid)!==before) fail('Backspace on body unexpectedly changed slide count');
if(!await alive(sid)) fail('app/seam gone after body Backspace');
console.log('  Backspace outside the sidebar is swallowed, deletes nothing, app alive ✓');

// --- Case C: Backspace still deletes a SELECTED ELEMENT (no regression) -----
await exec(sid,"var g=window.__eigendeck.store.getState; g().selectSlide(0); g().addElement({id:'bk',type:'text',preset:'title',html:'x',position:{x:60,y:60,width:600,height:160}}); g().selectObject({type:'element',id:'bk'});");
await sleep(200);
const c=await exec(sid, bkspOn("document.body"));
await sleep(200);
const hasEl=await exec(sid,"return window.__eigendeck.store.getState().presentation.slides[0].elements.some(e=>e.id==='bk')");
if(c==='NOT_PREVENTED') fail('element-delete Backspace not prevented');
if(hasEl) fail('Backspace did not delete the selected element');
console.log('  Backspace still deletes a selected element ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('BKSP_PASS: Backspace never falls through to history-back; sidebar deletes its slide');
process.exit(0);
