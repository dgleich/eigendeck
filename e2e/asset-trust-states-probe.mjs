// Asset-security SPEC conformance (docs/ASSETS-SECURITY.md): prove the observable
// trusted/untrusted × approved/unapproved × watched matrix on ONE deck, one launch.
//
// A watched local video re-stores its bytes when the file changes on disk ONLY when
// the deck is trusted AND that path is approved. We drive a CLI-built (untrusted)
// fixture through every state and assert bytes DO / DON'T follow the disk:
//
//   1. UNTRUSTED            → mutate clip.mp4 → NO reload (zero disk reads; snapshot)
//   2. TRUST                → mutate clip.mp4 → reloads (trusted + auto-approved path)
//   3. TRUSTED, NEW PATH    → mutate clip2.mp4 → NO reload (per-path gate: trust≠blanket)
//   4. APPROVE the new path → mutate clip2.mp4 → reloads (approval turns it on)
//   5. REVOKE               → mutate clip.mp4 → NO reload (trust+approvals dropped)
//
// Byte-level (no codecs), so it runs headlessly. Needs an empty deck under HOME
// (fs:allow-watch scope), same as video-watch-probe.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const CLIP = join(dirname(DECK), 'clip.mp4');
const CLIP2 = join(dirname(DECK), 'clip2.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('TRUST_STATES_FAIL:', m); process.exit(1); };
const len = (sid, id) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'${id}'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));`);
const trust = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const revoke = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.revokeDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
// Real-enough mp4 bytes (the content gate needs "ftyp" at offset 4; a blob of zeros
// is rejected as content-mismatch — the security feature working as designed).
const mp4 = (n, v) => { const a = Buffer.alloc(n, v); a[4]=0x66; a[5]=0x74; a[6]=0x79; a[7]=0x70; return a; };
const storeVideo = (sid, path, id, n) => execA(sid, `const d=arguments[arguments.length-1];const a=new Uint8Array(${n}).fill(7);a[4]=102;a[5]=116;a[6]=121;a[7]=112;window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(a),mimeType:'video/mp4',externalPath:'${path}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
// Wait for the stored bytes to reach `want`; returns true if it did within ~15s.
async function waitLen(sid, id, want){ for(let i=0;i<20;i++){ await sleep(800); if(await len(sid,id)===want) return true; } return false; }
// Confirm the stored bytes STAY at `want` for ~8s (i.e. NO reload happened).
async function staysLen(sid, id, want){ for(let i=0;i<10;i++){ await sleep(800); if(await len(sid,id)!==want) return false; } return true; }

writeFileSync(CLIP, mp4(1000, 1));
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
if (await storeVideo(sid,'clip.mp4','va1',1000) !== 'ok') fail('store va1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'v1',type:'video',kind:'file',assetId:'va1',position:{x:60,y:60,width:400,height:225}});");
await sleep(3000);   // watcher subscribes + baseline
if (await len(sid,'va1') !== 1000) fail('va1 baseline wrong');

// ── 1. UNTRUSTED → no reload ────────────────────────────────────────────────
writeFileSync(CLIP, mp4(5000, 2));
if (!await staysLen(sid,'va1',1000)) fail('1) UNTRUSTED deck reloaded a changed file (should be zero disk reads)');
console.log('  1) untrusted → clip.mp4 change NOT read (snapshot stays 1000) ✓');

// ── 2. TRUST → reload ───────────────────────────────────────────────────────
if (await trust(sid) !== 'ok') fail('trust deck');
// Trust pulls the file's CURRENT on-disk bytes (5000, changed in step 1) and, because
// that reload fires asset-changed, the thumbnail re-subscribes its watcher. Wait for
// the pull + let the re-subscribe settle before the next edit.
if (!await waitLen(sid,'va1',5000)) fail('2a) trust did not pull the current on-disk bytes');
await sleep(2500);
writeFileSync(CLIP, mp4(7000, 3));
if (!await waitLen(sid,'va1',7000)) fail('2) TRUSTED+approved file did NOT live-reload after trust');
console.log('  2) trust → clip.mp4 pulled (5000) then live-reloads on edit (→ 7000) ✓');

// ── 3. TRUSTED but a NEW, unapproved path → no reload ───────────────────────
writeFileSync(CLIP2, mp4(2000, 4));
if (await storeVideo(sid,'clip2.mp4','va2',2000) !== 'ok') fail('store va2');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'v2',type:'video',kind:'file',assetId:'va2',position:{x:60,y:320,width:400,height:225}});");
await sleep(3000);   // watcher subscribes to clip2
if (await len(sid,'va2') !== 2000) fail('va2 baseline wrong');
writeFileSync(CLIP2, mp4(6000, 5));
if (!await staysLen(sid,'va2',2000)) fail('3) a NEW unapproved path reloaded on a trusted deck (per-path gate leaked)');
console.log('  3) trusted, path unapproved → clip2.mp4 change NOT read (stays 2000) ✓');

// ── 4. APPROVE the new path (Trust-this-deck re-approves current links) ──────
if (await trust(sid) !== 'ok') fail('re-trust to approve clip2');
// approval + scan pulls clip2's current on-disk bytes (6000) and re-subscribes.
if (!await waitLen(sid,'va2',6000)) fail('4a) approve did not pull the current on-disk bytes');
await sleep(2500);
writeFileSync(CLIP2, mp4(8000, 6));
if (!await waitLen(sid,'va2',8000)) fail('4) approving the path did NOT enable live-reload');
console.log('  4) approve → clip2.mp4 pulled (6000) then live-reloads on edit (→ 8000) ✓');

// ── 5. REVOKE → back to snapshot (no reload) ────────────────────────────────
if (await revoke(sid) !== 'ok') fail('revoke deck');
writeFileSync(CLIP, mp4(9000, 7));
if (!await staysLen(sid,'va1',7000)) fail('5) a REVOKED deck still reloaded (trust/approvals not dropped)');
console.log('  5) revoke → clip.mp4 change NOT read (reverts to snapshot, stays 7000) ✓');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('TRUST_STATES_PASS: untrusted/trusted/approved/revoked watch matrix matches the spec');
process.exit(0);
