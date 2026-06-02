// Background auto-discovery of available kernels on every registered
// Jupyter server. Runs once on app start (so the topbar pill shows
// fresh status without the user having to click "Test connection"
// or "Refresh all" in Settings) and one-shot whenever a new server
// is saved (handled inline in SettingsModal's row).
//
// We DON'T poll continuously. Doing so would write to the user's
// terminal logs (each Jupyter request is a line) and add network
// noise during talks. The presenter can manually refresh from the
// pill dropdown when they want fresh status.
//
// Result of a successful ping: updates the entry's availableKernels
// + lastSeenAt and writes the registry back. A failed ping leaves
// the entry alone — the pill's staleness derives from lastSeenAt,
// so users can see "haven't been able to reach this in a while."

import {
  getPreference, setPreference, type JupyterServerEntry,
} from './preferences';

/** Probe one server. On success, returns the updated entry (with
 *  fresh availableKernels + lastSeenAt). On failure, returns the
 *  original entry untouched. Never throws. */
async function probeServer(s: JupyterServerEntry): Promise<JupyterServerEntry> {
  try {
    const url = s.baseUrl.replace(/\/$/, '');
    const q = s.token ? `?token=${encodeURIComponent(s.token)}` : '';
    const r = await fetch(`${url}/api/kernelspecs${q}`, {
      headers: s.token ? { Authorization: `token ${s.token}` } : {},
    });
    if (!r.ok) return s;
    const data = await r.json();
    const kernels = Object.keys(data.kernelspecs ?? {});
    return { ...s, availableKernels: kernels, lastSeenAt: Date.now() };
  } catch {
    return s;
  }
}

/** Probe every registered server in parallel, then write the new
 *  registry. Silent — no UI feedback. The topbar pill picks up the
 *  change via its usePreference subscription. */
export async function discoverAllServers(): Promise<void> {
  const servers = getPreference('jupyterServers');
  if (servers.length === 0) return;
  const updated = await Promise.all(servers.map(probeServer));
  // Only write if anything actually changed — avoids a no-op
  // pref-changed event that triggers re-renders for nothing.
  const changed = updated.some((u, i) =>
    u.lastSeenAt !== servers[i].lastSeenAt
    || JSON.stringify(u.availableKernels) !== JSON.stringify(servers[i].availableKernels)
  );
  if (changed) setPreference('jupyterServers', updated);
}
