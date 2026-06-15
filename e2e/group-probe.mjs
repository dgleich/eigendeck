// Bug hunt: slide grouping + group-aware duplicate insertion + persistence.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=m=>{console.error('GRP_FAIL:',m);process.exit(1);};
const grp=sid=>exec(sid,"return JSON.stringify(window.__eigendeck.store.getState().presentation.slides.map(s=>s.groupId?s.groupId.slice(0,4):'-'));");
const problems=[];

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
// 3 slides total
await exec(sid,"const s=window.__eigendeck.store.getState(); s.addSlide(); s.addSlide();");
await sleep(300);
let n=await exec(sid,"return window.__eigendeck.store.getState().presentation.slides.length;");
if(n!==3) problems.push('expected 3 slides, got '+n);
// group slides 0 and 1
await exec(sid,"window.__eigendeck.store.getState().groupSlides([0,1]);");
await sleep(200);
let g=JSON.parse(await grp(sid));
if(!(g[0]!=='-'&&g[0]===g[1]&&g[2]==='-')) problems.push('grouping wrong: '+JSON.stringify(g));
console.log('  after group:', JSON.stringify(g));
// duplicate slide 0 → copy should land AFTER the group (index 2), not at index 1
await exec(sid,"window.__eigendeck.store.getState().duplicateSlide(0);");
await sleep(300);
g=JSON.parse(await grp(sid));
n=g.length;
// expect: [G,G,?,-] where the dup (also groupId G? duplicateSlide copies groupId) lands at idx2
console.log('  after duplicate slide0:', JSON.stringify(g), 'n='+n);
if(n!==4) problems.push('expected 4 slides after dup, got '+n);
// the slide at index 1 must still be in the group (dup didn't split the group)
if(g[0]!==g[1]) problems.push('group split by duplicate: '+JSON.stringify(g));

// persist groupId
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);
sid=await open(); if(!sid||!await waitSeam(sid)) fail('reopen');
await sleep(500);
const g2=JSON.parse(await grp(sid));
console.log('  after reopen:', JSON.stringify(g2));
if(g2[0]==='-'||g2[0]!==g2[1]) problems.push('groupId not persisted: '+JSON.stringify(g2));
await quit(sid);
if(problems.length){ console.error('GRP_BUGS: '+problems.join(' | ')); process.exit(2); }
console.log('GRP_PASS: grouping + group-aware duplicate + persistence OK');
process.exit(0);
