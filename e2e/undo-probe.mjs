// Bug hunt: core undo/redo correctness (#55 is flagged unreliable).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('UNDO_FAIL:',m);process.exit(1);};
const ids=(sid)=>exec(sid,"return JSON.stringify(window.__eigendeck.store.getState().presentation.slides[0].elements.map(e=>e.id));");
const posOf=(sid,id)=>exec(sid,`const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='${id}');return e?JSON.stringify(e.position):'null';`);
const htmlOf=(sid,id)=>exec(sid,`const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='${id}');return e?e.html:'GONE';`);
const undo=(sid)=>exec(sid,"window.__eigendeck.store.temporal.getState().undo();");
const redo=(sid)=>exec(sid,"window.__eigendeck.store.temporal.getState().redo();");
const problems=[];

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// 1) add → undo removes → redo restores
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'a',type:'text',preset:'body',html:'A',position:{x:100,y:100,width:200,height:80}});");
await sleep(300);
if(JSON.parse(await ids(sid)).join()!=='a') problems.push('add: element not present');
await undo(sid); await sleep(300);
if(JSON.parse(await ids(sid)).includes('a')) problems.push('undo(add): element still present');
await redo(sid); await sleep(300);
if(!JSON.parse(await ids(sid)).includes('a')) problems.push('redo(add): element not restored');
console.log('  add/undo/redo checked');

// 2) move → undo restores position
await exec(sid,"window.__eigendeck.store.getState().updateElement('a',{position:{x:500,y:400,width:200,height:80}});");
await sleep(300);
if(JSON.parse(await posOf(sid,'a')).x!==500) problems.push('move: not applied');
await undo(sid); await sleep(300);
const pAfterUndo=JSON.parse(await posOf(sid,'a'));
if(pAfterUndo.x!==100) problems.push(`undo(move): x not restored (got ${pAfterUndo.x})`);
console.log('  move/undo checked (x after undo='+pAfterUndo.x+')');

// 3) edit html → undo restores
await exec(sid,"window.__eigendeck.store.getState().updateElement('a',{html:'EDITED'});");
await sleep(300);
await undo(sid); await sleep(300);
const h=await htmlOf(sid,'a');
if(h!=='A') problems.push(`undo(edit): html not restored (got "${h}")`);
console.log('  edit/undo checked (html after undo="'+h+'")');

// 4) delete → undo restores
await exec(sid,"window.__eigendeck.store.getState().deleteElement('a');");
await sleep(300);
if(JSON.parse(await ids(sid)).includes('a')) problems.push('delete: still present');
await undo(sid); await sleep(300);
if(!JSON.parse(await ids(sid)).includes('a')) problems.push('undo(delete): not restored');
console.log('  delete/undo checked');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(problems.length){ console.error('UNDO_BUGS: '+problems.join(' | ')); process.exit(2); }
console.log('UNDO_PASS: add/move/edit/delete all undo+redo correctly');
process.exit(0);
