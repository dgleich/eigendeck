// Audit C-3 (Phase 1b) regression: the arbitrary-path filesystem commands are
// caller-authorized in Rust (require_main / require_windows in fscmds.rs), so a
// SECONDARY privileged window (here the real Security window, label "security")
// cannot drive them even though it has IPC access. This is the negative test the
// audit asked for — it proves the MITIGATION, not merely that the helpers work.
//
//   - write_text_file from the main window     → SUCCEEDS, file appears on disk
//   - write_text_file from the Security window  → REJECTED, and NO file is created
//   - resolve_and_read from the Security window  → REJECTED (allowlist is main+presenter)
//
// The invoke goes through window.__TAURI_INTERNALS__.invoke (reaches the real Rust
// command); the Node harness checks the filesystem directly (it, unlike the webview,
// can see disk) to prove the write never happened.
import { existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { openApp, waitSeam, quit, handles, switchTo, execA,
         findMainHandle, openSecurityWindow } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK, HOME = dirname(DECK);
const fail = (m) => { console.error('FS_GUARD_FAIL:', m); process.exit(1); };

// invoke a command inside whichever window the session is currently switched to;
// resolves to 'OK' or 'ERR:<message>'.
const invokeIn = (sid, cmd, args) => execA(sid,
  `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('${cmd}',${JSON.stringify(args)}).then(()=>d('OK')).catch(e=>d('ERR:'+String(e)));`);

const mainPath = join(HOME, 'guard-main-write.txt');
const secPath = join(HOME, 'guard-secondary-write.txt');
for (const p of [mainPath, secPath]) { try { rmSync(p); } catch { /* absent */ } }

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open');
const mainH = await findMainHandle(sid);

// --- positive control: the main editor window CAN write --------------------
await switchTo(sid, mainH);
const mainRes = await invokeIn(sid, 'write_text_file', { path: mainPath, text: 'main-window-write', append: false });
if (mainRes !== 'OK') fail(`main-window write_text_file should succeed, got ${mainRes}`);
if (!existsSync(mainPath)) fail('main-window write_text_file returned OK but no file on disk');
console.log('  0) main window → write_text_file succeeds, file on disk ✓');

// --- the mitigation: a SECONDARY window is refused -------------------------
const secH = await openSecurityWindow(sid, mainH); if (!secH) fail('Security window did not open');
await switchTo(sid, secH);

const secRes = await invokeIn(sid, 'write_text_file', { path: secPath, text: 'PWNED-from-security', append: false });
if (!String(secRes).startsWith('ERR:')) fail(`security-window write_text_file should be REJECTED, got ${secRes}`);
if (!String(secRes).includes("not permitted from window 'security'")) fail(`unexpected rejection message: ${secRes}`);
if (existsSync(secPath)) fail('security-window write was rejected but a file was created anyway — guard leaked');
console.log('  1) security window → write_text_file rejected, NO file created ✓');

// resolve_and_read allowlist is main+presenter, so the Security window is refused too.
const readRes = await invokeIn(sid, 'resolve_and_read', { path: mainPath, maxBytes: null });
if (!String(readRes).startsWith('ERR:')) fail(`security-window resolve_and_read should be REJECTED, got ${readRes}`);
if (!String(readRes).includes("not permitted from window 'security'")) fail(`unexpected read rejection message: ${readRes}`);
console.log('  2) security window → resolve_and_read rejected (allowlist main+presenter) ✓');

for (const p of [mainPath, secPath]) { try { rmSync(p); } catch { /* absent */ } }
await quit(sid);
console.log('FS_GUARD_PASS: arbitrary-path fs commands honor the main-window caller check; secondary windows are refused and write nothing');
process.exit(0);
