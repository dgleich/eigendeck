// E2E coverage beacon (spike). Active ONLY in Istanbul-instrumented builds
// (COVERAGE_INSTRUMENT=1 → vite-plugin-istanbul → window.__coverage__ exists).
// It periodically POSTs the coverage map to the e2e collector server
// (e2e/coverage-server.mjs), so EVERY e2e probe contributes its real-WebKitGTK
// line hits with zero per-probe changes. A no-op in normal builds (no
// __coverage__), so calling it unconditionally from main is free.
export function installCoverageBeacon(): void {
  const w = window as unknown as { __coverage__?: unknown; __covBeaconInstalled?: boolean };
  if (!w.__coverage__ || w.__covBeaconInstalled) return;
  w.__covBeaconInstalled = true;

  // One stable id per page → the collector overwrites cov-<id>.json each POST,
  // keeping only the latest cumulative snapshot (so re-posting never double-counts).
  const id = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const url = `/__coverage__?id=${id}`;

  const send = (): void => {
    try {
      // Plain fetch (NOT keepalive): the coverage body far exceeds the 64KB
      // keepalive/sendBeacon cap, so a keepalive request would be silently dropped.
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w.__coverage__),
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  // Coverage is cumulative; snapshot early (short probes) then on an interval so we
  // capture hits even if the rig hard-closes the session without a clean teardown.
  setTimeout(send, 1000);
  setInterval(send, 1500);
  // Best-effort final flush (sendBeacon is >64KB-capped so it usually no-ops here;
  // the last interval already captured essentially everything).
  window.addEventListener('pagehide', () => { send(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
}
