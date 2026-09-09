// E2E coverage beacon. Active ONLY in Istanbul-instrumented builds
// (COVERAGE_INSTRUMENT=1 → vite-plugin-istanbul → window.__coverage__ exists).
// It periodically POSTs the coverage map to the e2e collector server
// (e2e/coverage-server.mjs), so EVERY e2e probe contributes its real-WebKitGTK
// line hits with zero per-probe changes. A no-op in normal builds (no
// __coverage__), so calling it unconditionally from main is free.
//
// It also exposes window.__covFlush() so a probe can await one final POST
// before it tears the session down. Without that, the last interval window
// (up to 1.5 s of hits) is lost on every page, and a secondary window closed
// inside its first second never reports at all. e2e/_ui.mjs quit() calls it.
export function installCoverageBeacon(): void {
  const w = window as unknown as {
    __coverage__?: unknown;
    __covBeaconInstalled?: boolean;
    __covFlush?: () => Promise<void>;
  };
  if (!w.__coverage__ || w.__covBeaconInstalled) return;
  w.__covBeaconInstalled = true;

  // One stable id per page → the collector overwrites cov-<id>.json each POST,
  // keeping only the latest cumulative snapshot (so re-posting never double-counts).
  const id = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const url = `/__coverage__?id=${id}`;

  const send = (): Promise<void> => {
    try {
      // Plain fetch (NOT keepalive): the coverage body far exceeds the 64KB
      // keepalive/sendBeacon cap, so a keepalive request would be silently dropped.
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w.__coverage__),
      }).then(() => undefined, () => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  // Coverage is cumulative; snapshot early (short probes) then on an interval so we
  // capture hits even if the rig hard-closes the session without a clean teardown.
  setTimeout(() => { void send(); }, 1000);
  setInterval(() => { void send(); }, 1500);
  // Best-effort final flush on unload (usually truncated; the explicit
  // __covFlush from the probe is the reliable path).
  window.addEventListener('pagehide', () => { void send(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void send();
  });
  w.__covFlush = send;
}
