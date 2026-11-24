// #213 guard: opening an app window must not stall. tao 0.37 asked the desktop portal
// for the system theme, synchronously with a 5 s timeout, on every window creation;
// where the portal never answers (the CI runner) each window opened 5 s late and the
// presenter's ready handshake timed out, so Eigendeck closed the window. Tauri's "dbus"
// feature is now off. This creates each app window straight from the main window and
// fails if the create command takes longer than LIMIT_MS, or the window never shows up
// in Tauri's list and as a WebDriver handle.
import { openApp, waitSeam, handles, findMainHandle, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const LIMIT_MS = 2000;
const fail = (m) => { console.error('WINDOW_CREATE_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');
const mainH = await findMainHandle(sid);

const inv = (cmd, args) => execA(sid, `const done = arguments[arguments.length - 1];
  window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((r) => done(JSON.stringify(r ?? null)), (e) => done('ERR ' + String(e)));`);

const report = [];
for (const [label, url] of [['presenter', '/presenter.html'], ['security', '/security.html'], ['settings', '/settings.html']]) {
  const t0 = Date.now();
  const r = await inv('plugin:webview|create_webview_window', { options: { label, url, title: 'probe', width: 800, height: 600 } });
  const ms = Date.now() - t0;
  if (String(r).startsWith('ERR')) fail(`creating ${label}: ${r}`);
  let listed = false, handle = false;
  for (let i = 0; i < 20 && !(listed && handle); i++) {
    listed = String(await inv('plugin:window|get_all_windows', {})).includes(`"${label}"`);
    handle = (await handles(sid)).some((h) => h !== mainH);
    if (!(listed && handle)) await sleep(250);
  }
  if (!listed || !handle) fail(`${label} window never appeared (listed by Tauri: ${listed}, WebDriver handle: ${handle})`);
  if (ms > LIMIT_MS) fail(`creating the ${label} window took ${ms} ms (limit ${LIMIT_MS} ms): window creation is stalling again (#213)`);
  report.push(`${label} ${ms} ms`);
  await inv('plugin:window|close', { label });
  for (let i = 0; i < 20 && (await handles(sid)).length > 1; i++) await sleep(250);
}
await quit(sid);
console.log(`WINDOW_CREATE_PASS: windows open without stalling (${report.join(', ')})`);
process.exit(0);
