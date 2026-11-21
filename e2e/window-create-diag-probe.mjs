// #213 diagnostic (not a gate): create app windows straight from the main window, with
// no ready handshake or timeout, and record how long each takes to (a) resolve the
// create command, (b) show up in Tauri's window list and (c) get a WebDriver handle.
// Crosses the label (presenter/settings/security) with the page, to tell whether a
// stall depends on which window it is or on what the page loads.
import { openApp, waitSeam, handles, findMainHandle, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) { console.error('WINDIAG_FAIL: open/seam'); process.exit(1); }
const mainH = await findMainHandle(sid);

const inv = (cmd, args) => execA(sid, `const done = arguments[arguments.length - 1];
  window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((r) => done(JSON.stringify(r ?? null)), (e) => done('ERR ' + String(e)));`);

const variants = [
  ['settings', '/settings.html'],
  ['presenter', '/presenter.html'],
  ['settings', '/presenter.html'],
  ['presenter', '/settings.html'],
  ['security', '/security.html'],
];
for (const [label, url] of variants) {
  // Fire the create without awaiting it, and note when it resolves.
  await execA(sid, `const done = arguments[arguments.length - 1];
    window.__diag = { t0: performance.now(), resolved: null };
    window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { label: ${JSON.stringify(label)}, url: ${JSON.stringify(url)}, title: 'diag', width: 800, height: 600 } })
      .then(() => { window.__diag.resolved = Math.round(performance.now() - window.__diag.t0); }, (e) => { window.__diag.resolved = 'ERR ' + String(e); });
    done(1);`);
  const t0 = Date.now();
  let handleAt = null, listedAt = null, resolved = null;
  while (Date.now() - t0 < 20000 && (handleAt == null || listedAt == null || resolved == null)) {
    await sleep(250);
    const ms = Date.now() - t0;
    if (handleAt == null && (await handles(sid)).some((h) => h !== mainH)) handleAt = ms;
    if (listedAt == null && String(await inv('plugin:window|get_all_windows', {})).includes(`"${label}"`)) listedAt = ms;
    if (resolved == null) resolved = JSON.parse(await execA(sid, 'const done = arguments[arguments.length - 1]; done(JSON.stringify(window.__diag.resolved));'));
  }
  console.log(`  ${label} + ${url}: create resolved ${resolved ?? 'never'} ms, listed by Tauri ${listedAt ?? 'never'} ms, WebDriver handle ${handleAt ?? 'never'} ms (20 s budget)`);
  const closed = await inv('plugin:window|close', { label });
  if (String(closed).startsWith('ERR')) console.log(`    close ${label}: ${closed}`);
  for (let i = 0; i < 20 && (await handles(sid)).length > 1; i++) await sleep(250);
}
await quit(sid);
console.log('WINDIAG_DONE');
process.exit(0);
