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

// Read-only observer (allowed seam): the main-window trust report — deck token,
// trusted flag, per-linked-asset {approved, read} gate decision.
export async function trustReport(sid) {
  return JSON.parse(await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(r=>d(r)).catch(e=>d(JSON.stringify({error:String(e)})))"));
}

// Open the REAL Security window from the main window's inspector ("Linked files &
// security…"). Returns the new window's WebDriver handle (or null). Call while
// switched to the MAIN handle.
export async function openSecurityWindow(sid, mainH) {
  await exec(sid, "const s=window.__eigendeck.store.getState();if(!s.showProperties)s.toggleProperties();s.setInspectorTab('presentation');");
  await sleep(1200);
  await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('Linked files'));if(b)b.click();");
  for (let i = 0; i < 12; i++) { await sleep(700); const sec = (await handles(sid)).find((h) => h !== mainH); if (sec) return sec; }
  return null;
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

// End-to-end "trust + watch everything" through the REAL Security window, replacing
// the retired trust-all seam. Opens the window, clicks "Trust this deck" (if
// untrusted), approves every eligible folder, then switches back to the main window
// and waits until every linked asset reads OK. Closes the Security window.
// Returns true on success. `mainH` is the main window handle.
export async function trustAndWatchAllViaUI(sid, mainH) {
  const secH = await openSecurityWindow(sid, mainH);
  if (!secH) return false;
  await switchTo(sid, secH);
  // Trust if the deck isn't trusted yet (button only present while untrusted).
  await clickButtonWithText(sid, 'Trust this deck');
  // Wait for the re-init remount to finish rendering the trusted report (the
  // folder-approve buttons) — clicking during "Scanning…" would find nothing.
  await waitForText(sid, 'Approve all');
  await clickAllFolderApprovals(sid);
  await sleep(600);
  await exec(sid, "try{window.__TAURI_INTERNALS__ && (async()=>{const {getCurrentWebviewWindow}=await import('@tauri-apps/api/webviewWindow');getCurrentWebviewWindow().close();})();}catch(e){}");
  await switchTo(sid, mainH);
  // Confirm via the main-window observer that trust + approvals took.
  for (let i = 0; i < 15; i++) {
    await sleep(700);
    const rep = await trustReport(sid);
    if (rep.trusted && rep.rows.length > 0 && rep.rows.every((r) => r.read === 'ok')) return true;
    if (rep.trusted && rep.rows.length === 0) return true;
  }
  return false;
}
