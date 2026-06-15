// Bug hunt: do new text-styling fields + config.customPalette survive save→reopen?
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('SR_FAIL:',m);process.exit(1);};

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
await exec(sid, "const s=window.__eigendeck.store.getState(); s.addElement({id:'tx',type:'text',preset:'body',html:'styled',backgroundColor:'#fff3b0',backgroundOpacity:0.5,textEffect:'glow',position:{x:100,y:100,width:400,height:200}}); s.updateConfig({customPalette:['#0b3d91','#c8102e']});");
await sleep(500);
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);
console.log('  S1: styled element + palette saved');

sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
await sleep(800);
const got=await exec(sid, `
  const s=window.__eigendeck.store.getState();
  const el=s.presentation.slides.flatMap(sl=>sl.elements).find(e=>e.id==='tx');
  return JSON.stringify({
    bg: el && el.backgroundColor, op: el && el.backgroundOpacity, fx: el && el.textEffect,
    palette: s.presentation.config.customPalette || null
  });`);
await quit(sid);
console.log('  S2 reopened:', got);
const g=JSON.parse(got);
const probs=[];
if(g.bg!=='#fff3b0') probs.push(`backgroundColor lost (${g.bg})`);
if(g.op!==0.5) probs.push(`backgroundOpacity lost (${g.op})`);
if(g.fx!=='glow') probs.push(`textEffect lost (${g.fx})`);
if(!g.palette || g.palette.join()!=='#0b3d91,#c8102e') probs.push(`customPalette lost (${JSON.stringify(g.palette)})`);
if(probs.length){ console.error('SR_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('SR_PASS: all styling fields + customPalette survived save→reopen');
process.exit(0);
