// Shared e2e helpers for driving the REAL Eigendeck UI over WebDriver — including
// the separate Security window (via WebDriver window handles). Probes import these
// instead of reaching for action-seams: per the seam-discipline note, a probe must
// click the real control, not call the app logic behind it. The ONLY seams used
// here are foundational bypasses (the store, the read-only trustReport observer)
// and system-blocked stand-ins (save-in-place); never an app action.
export const BASE = 'http://127.0.0.1:4444';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function post(p, b) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
export async function get(p) {
  const r = await fetch(BASE + p); const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
export async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
export async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
export async function openApp(app, deck) {
  for (let i = 0; i < 12; i++) {
    const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app, args: [deck] } } } });
    if (j?.value?.sessionId) return j.value.sessionId;
    await sleep(1000);
  }
  return null;
}
export async function waitSeam(sid) {
  for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; }
  return false;
}
export async function quit(sid) { await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {}); }
export async function handles(sid) { return (await get(`/session/${sid}/window/handles`))?.value || []; }
export async function switchTo(sid, h) { await post(`/session/${sid}/window`, { handle: h }); }
// The MAIN window is the only one carrying the __eigendeck seam (the Security window
// is a separate entry point without it). Identify it by that, never by handle index —
// window open/close reorders handles, and a leftover Security window at [0] would be
// mistaken for main. Returns the handle, and leaves the session switched to it.
export async function findMainHandle(sid) {
  for (const h of await handles(sid)) {
    await switchTo(sid, h);
    if (await exec(sid, "return !!(window.__eigendeck)")) return h;
  }
  return (await handles(sid))[0];
}

// Read-only observer (allowed seam): the main-window trust report — deck token,
// trusted flag, per-linked-asset {approved, read} gate decision.
export async function trustReport(sid) {
  const raw = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(r=>d(r)).catch(e=>d(JSON.stringify({error:String(e)})))");
  try { return JSON.parse(raw); } catch { return { error: 'no-value', rows: [] }; }
}

// Open the REAL Security window from the main window's inspector ("Linked files &
// security…"). Returns the new window's WebDriver handle (or null). Call while
// switched to the MAIN handle.
export async function openSecurityWindow(sid, mainH) {
  await switchTo(sid, mainH);
  await exec(sid, "const s=window.__eigendeck.store.getState();if(!s.showProperties)s.toggleProperties();s.setInspectorTab('presentation');");
  await sleep(1200);
  await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('Linked files'));if(b)b.click();");
  for (let i = 0; i < 12; i++) { await sleep(700); const sec = (await handles(sid)).find((h) => h !== mainH); if (sec) return sec; }
  return null;
}

// Drag an element on the canvas via a REAL pointer gesture (pointerdown on the
// element → pointermoves past the 4px dead-zone → pointerup), exercising the real
// SlideElementRenderer drag handler — including its pauseUndo/resumeUndo grouping,
// so a drag collapses to ONE undo step. Moves the element to logical x=`targetX`
// (keeps y). Returns the element's resulting logical x. Replaces the pauseUndo/
// resumeUndo seam for undo-granularity tests.
export async function dragElementToX(sid, elementId, targetX) {
  return exec(sid, `
    const node = document.querySelector('[data-element-id="${elementId}"]');
    if (!node) return 'no-node';
    const st = window.__eigendeck.store.getState();
    const el = st.presentation.slides[0].elements.find(x => x.id === '${elementId}');
    if (!el) return 'no-el';
    const r = node.getBoundingClientRect();
    const scale = r.width / el.position.width;         // screen px per logical px
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const dxScreen = (${targetX} - el.position.x) * scale;
    const opt = (x, y) => ({ clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 });
    node.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
    const N = 6;
    for (let i = 1; i <= N; i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + (dxScreen * i / N), y0)));
    window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + dxScreen, y0)));
    const after = window.__eigendeck.store.getState().presentation.slides[0].elements.find(x => x.id === '${elementId}');
    return after ? after.position.x : 'gone';
  `);
}

// The following run in the SECURITY window (switch to secH first).
// Poll until the window's text contains `substr` (report finished rendering).
export async function waitForText(sid, substr, tries = 15) {
  for (let i = 0; i < tries; i++) { await sleep(600); if (await exec(sid, `return (document.body.textContent||'').includes(${JSON.stringify(substr)})`)) return true; }
  return false;
}
// Click the first <button> whose visible text contains `substr`. Returns true if found.
export async function clickButtonWithText(sid, substr) {
  return await exec(sid, `const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes(${JSON.stringify(substr)}));if(b){b.click();return true;}return false;`);
}
// Click the "Approve" button inside the row whose text contains `refSubstr`.
export async function clickApproveInRow(sid, refSubstr) {
  return await exec(sid, `
    const row=[...document.querySelectorAll('div')].find(d=>(d.textContent||'').includes(${JSON.stringify(refSubstr)}) && [...d.querySelectorAll('button')].some(b=>b.textContent.trim()==='Approve'));
    if(!row) return false;
    const b=[...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve');
    if(b){b.click();return true;} return false;`);
}
// Click the folder-level "Approve all N files" button for the folder group whose
// header path contains `dirSubstr`. The button label is "Approve all N files" (NO
// folder name), so match on the button's PARENT header text, which renders the
// folder path (PathText) alongside the button. Returns true if clicked.
export async function clickApproveDir(sid, dirSubstr) {
  return await exec(sid, `
    const b=[...document.querySelectorAll('button')].find(x=>/^Approve all /.test((x.textContent||'').trim()) && ((x.parentElement&&x.parentElement.textContent)||'').includes(${JSON.stringify(dirSubstr)}));
    if(b){b.click();return true;} return false;`);
}
// Click EVERY "Approve all … in …" folder button, one per settle. Returns how many.
export async function clickAllFolderApprovals(sid) {
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const clicked = await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>/^Approve all /.test((x.textContent||'').trim()));if(b){b.click();return true;}return false;");
    if (!clicked) break;
    n++; await sleep(900);
  }
  return n;
}
// Are there any per-row "Approve" buttons visible? (used to prove the untrusted
// invariant: no approving before trusting.)
export async function hasApproveControls(sid) {
  return await exec(sid, "return [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Approve'||/^Approve all /.test(x.textContent.trim()));");
}

// Close the Security window RELIABLY: switch to the MAIN window first, then close
// the 'security' webview by label from there. Closing it from inside itself would
// destroy the WebDriver session's current window and make the next switch/exec fail
// (returns undefined). Waits until only the main handle remains.
export async function closeSecurityWindow(sid, mainH) {
  // The window is now dialog-style with no in-content close (OS close only), and the
  // app re-sends security:init when the window is reopened — which remounts it with
  // fresh deck state (invalidating its ledger cache). So instead of forcing a close
  // (WebDriver's window-delete doesn't cleanly tear down the Tauri window, and a real
  // OS-chrome click isn't scriptable here), just return to the main window; the next
  // openSecurityWindow reuses + refreshes the same window. No stale-report risk.
  await switchTo(sid, mainH);
}

// End-to-end "trust + watch everything" through the REAL Security window, replacing
// the retired trust-all seam. Opens the window, clicks "Trust this deck" (if
// untrusted), approves every eligible folder, then switches back to the main window
// and waits until every linked asset reads OK. Closes the Security window.
// Returns true on success. `mainH` is the main window handle.
export async function trustAndWatchAllViaUI(sid, mainH) {
  if (!mainH) mainH = await findMainHandle(sid);
  const secH = await openSecurityWindow(sid, mainH);
  if (!secH) return false;
  await switchTo(sid, secH);
  // Trust if the deck isn't trusted yet (button only present while untrusted).
  await clickButtonWithText(sid, 'Trust this deck');
  // Wait for the re-init remount to finish rendering the trusted report — clicking
  // during "Scanning…" would find nothing.
  await waitForText(sid, 'Approve');
  // Approve EVERYTHING the window offers — folder "Approve all …" bulk buttons AND
  // per-row "Approve" (a root-level / single file shows a per-row Approve, not a
  // folder button; the folder-only click missed it, so nothing got approved — #150).
  // Loop until no approve control remains; the list re-renders after each click.
  let nApproved = 0;
  for (let i = 0; i < 25; i++) {
    const clicked = await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>{const t=(x.textContent||'').trim();return t==='Approve'||/^Approve all /.test(t);});if(b){b.click();return true;}return false;");
    if (!clicked) break;
    nApproved++; await sleep(900);
  }
  await sleep(600);
  await closeSecurityWindow(sid, mainH);
  // Force a main-window rescan + ledger-cache invalidation even when nothing was
  // approvable (e.g. all files missing) — the old trust seam re-scanned too.
  await exec(sid, "import('@tauri-apps/api/event').then(m=>m.emit('eigendeck:security-changed')).catch(()=>{});");
  // Confirm via the main-window observer that trust + approvals took: the deck is
  // trusted and every gateable (present, allowed-type) linked file is approved.
  // Missing / blocked rows can't be approved from the window, so they're excluded —
  // trusting is enough for them (the relocate flow approves a moved file separately).
  for (let i = 0; i < 15; i++) {
    await sleep(700);
    const rep = await trustReport(sid);
    // trustReport can transiently error mid-rescan (no .rows) — just retry.
    if (rep && rep.trusted && Array.isArray(rep.rows) && rep.rows.filter((r) => r.gateOk).every((r) => r.approved)) return true;
    if (i === 14) console.error('  [trustAndWatchAllViaUI] gave up:', JSON.stringify({ nApproved, rep }));
  }
  return false;
}

// Stop trusting the deck through the REAL "Stop trusting this deck" button, replacing
// the retired revokeDeck seam. Returns true once the main window observes untrusted.
export async function revokeViaUI(sid, mainH) {
  if (!mainH) mainH = await findMainHandle(sid);
  const secH = await openSecurityWindow(sid, mainH);
  if (!secH) return false;
  await switchTo(sid, secH);
  await waitForText(sid, 'Stop trusting this deck');
  // "Stop trusting" guards on a NATIVE confirm dialog (WebDriver can't click it) —
  // preset the sanctioned test stand-in (src/lib/confirmDialog.ts) to answer "yes".
  await exec(sid, "window.__eigendeckConfirm = true;");
  if (!(await clickButtonWithText(sid, 'Stop trusting this deck'))) { await switchTo(sid, mainH); return false; }
  await sleep(800);
  await closeSecurityWindow(sid, mainH);
  await exec(sid, "import('@tauri-apps/api/event').then(m=>m.emit('eigendeck:security-changed')).catch(()=>{});");
  for (let i = 0; i < 15; i++) { await sleep(700); const rep = await trustReport(sid); if (rep && !rep.trusted) return true; }
  return false;
}
