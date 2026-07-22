// Copy a notebook (MARK_A) on slide 1, paste it on the EMPTY slide 2 (cross-slide
// → linked copy), save, QUIT, relaunch, and assert the pasted notebook on slide 2
// carries the recording (MARK_A) — "copy carries the overlay". Drives the real
// copy EVENT (handleCopy writes the private Eigendeck flavor to clipboardData)
// + a paste event carrying it, so the actual App.tsx handlers (runCopyHook) run.
// (The old keydown-Cmd+C / clipboardRef buffer was retired by the redesign.)
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function execSync(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await execSync(sid,"return document.body?document.body.textContent:''")||'');}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await execSync(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('COPYPASTE_FAIL:',m);process.exit(1);};

let sid=await open(); if(!sid) fail('s1 no start');
if(!await waitSeam(sid)) fail('s1 deck not open');
for(let i=0;i<15;i++){await sleep(800); if((await dom(sid)).includes('MARK_A'))break;}

const r=await execAsync(sid,`
  const done=arguments[arguments.length-1];
  (async()=>{
    const E=window.__eigendeck, s=E.store;
    s.getState().selectSlide(0);
    s.getState().selectObject({type:'element', id:'nb1'});
    await new Promise(r=>setTimeout(r,100));
    // Copy via the real 'copy' EVENT — handleCopy writes the private flavor to clipboardData.
    const cdt=new DataTransfer();
    document.body.dispatchEvent(new ClipboardEvent('copy',{clipboardData:cdt,bubbles:true,cancelable:true}));
    const html=cdt.getData('text/html');
    if(!/data-eigendeck-json=/.test(html||'')){done('ERR:copy wrote no private flavor');return;}
    await new Promise(r=>setTimeout(r,100));
    // Move to the empty slide 2, then paste WITH the captured private flavor.
    s.getState().selectSlide(1);
    await new Promise(r=>setTimeout(r,100));
    const pdt=new DataTransfer(); pdt.setData('text/html',html);
    document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:pdt,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,1500));   // let runCopyHook clone the overlay
    // How many elements landed on slide 2?
    const n = s.getState().presentation.slides[1].elements.length;
    await E.flush(); await E.save();
    done('pasted:'+n);
  })().catch(e=>done('ERR:'+e));
`);
if(typeof r!=='string'||!r.startsWith('pasted:')) fail('s1 copy/paste: '+r);
if(r==='pasted:0') fail('paste produced no element on slide 2 (event not handled)');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
await sleep(2500);

// Session 2: reopen, go to slide 2, assert the pasted notebook shows MARK_A.
let sid2=await open(); if(!sid2) fail('s2 no start');
if(!await waitSeam(sid2)) fail('s2 deck not open');
await execSync(sid2,"window.__eigendeck.store.getState().selectSlide(1);");
let txt=''; for(let i=0;i<18;i++){await sleep(800); txt=await dom(sid2); if(txt.includes('MARK_A'))break;}
await fetch(`${BASE}/session/${sid2}`,{method:'DELETE'}).catch(()=>{});
if(txt.includes('MARK_A')){ console.log('COPYPASTE_PASS: pasted notebook carried its recording (MARK_A) across save+reopen'); process.exit(0); }
fail('pasted notebook on slide 2 did NOT show MARK_A after reopen');
