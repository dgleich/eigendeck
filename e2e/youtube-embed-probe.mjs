// e2e: a YouTube video element (#149). Adds a youtube embed, presents it, and checks
// the real iframe: correct /embed/ src + `allow`, and — best-effort — whether it
// actually LOADS in the rig's WebKitGTK.
//
// SCOPE LIMIT: the rig serves the frontend from the DEV origin (http://localhost:1420),
// NOT the packaged custom scheme (tauri://localhost). #149 is that YouTube fails in the
// INSTALLED app but works in dev — so a green here proves the embed MECHANICS, not the
// packaged-origin case (that needs a real .app). A RED "load" here (youtube refused /
// no network) is still a useful signal.
import { openApp, waitSeam, exec, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const VID = 'dQw4w9WgXcQ';
const fail = (m) => { console.error('YT_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

// Add a YouTube embed element, then present so PresentVideo renders the real iframe.
await exec(sid, `window.__eigendeck.store.getState().addElement({id:'ytvid',type:'video',kind:'embed',provider:'youtube',url:'https://www.youtube.com/watch?v=${VID}',controls:true,position:{x:200,y:150,width:1200,height:680}});`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");

let info = null;
for (let i = 0; i < 20; i++) { await sleep(500); info = await exec(sid, `const f=document.querySelector('iframe[title="video"]');return f?JSON.stringify({src:f.getAttribute('src'),allow:f.getAttribute('allow')}):null;`); if (info) break; }
if (!info) fail('no video iframe rendered in present mode');
const { src, allow } = JSON.parse(info);
console.log('YT iframe src:', src);
console.log('YT iframe allow:', allow);
if (!src || !src.includes('youtube') || !src.includes(VID)) fail(`embed src missing youtube/${VID}: ${src}`);
if (!src.includes('/embed/')) fail(`not an /embed/ URL: ${src}`);
if (!allow) fail('missing iframe allow attribute (VIDEO_EMBED_ALLOW)');

// Best-effort: does the iframe actually load from YouTube in the rig's WebKit?
const load = await execA(sid, `const d=arguments[arguments.length-1];const f=document.querySelector('iframe[title="video"]');if(!f)return d(JSON.stringify({verdict:'no-iframe'}));let done=false;const fin=(o)=>{if(!done){done=true;d(JSON.stringify(o));}};f.addEventListener('load',()=>fin({verdict:'loaded',cw:!!f.contentWindow}));f.addEventListener('error',()=>fin({verdict:'error'}));setTimeout(()=>fin({verdict:'timeout',cw:!!f.contentWindow}),9000);`);
console.log('YT load verdict (informational — rig serves the DEV origin):', load);

await quit(sid);
console.log(`YT_PASS: youtube embed renders with correct /embed/ src + allow; load=${load}`);
process.exit(0);
