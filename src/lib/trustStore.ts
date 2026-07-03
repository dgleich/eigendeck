// App-side persistence + accessors for the asset-security trust ledger.
//
// The pure state machine lives in trustLedger.mjs; this wraps it with:
//   - lazy load from a JSON file in Tauri's appDataDir (in-memory cache),
//   - best-effort write-through on every mutation,
//   - graceful degradation to in-memory-only when Tauri APIs are absent
//     (tests / CLI / non-Tauri), so callers never need to special-case that.
//
// The ledger is app-side (per docs/ASSETS-SECURITY.md) — one ledger per machine,
// keyed by deck-token; it is NOT stored in any deck.

import { TrustLedger } from './trustLedger.mjs';

const LEDGER_FILE = 'asset-trust-ledger.json';

type FsLike = {
  appDataDir: () => Promise<string>;
  join: (...p: string[]) => Promise<string>;
  readTextFile: (p: string) => Promise<string>;
  writeTextFile: (p: string, s: string) => Promise<void>;
  mkdir: (p: string, o?: { recursive?: boolean }) => Promise<void>;
  exists: (p: string) => Promise<boolean>;
};

// Resolve the Tauri path/fs APIs once; null when unavailable (non-Tauri context).
let _fs: FsLike | null | undefined;
async function fs(): Promise<FsLike | null> {
  if (_fs !== undefined) return _fs;
  try {
    const path = await import('@tauri-apps/api/path');
    const plugin = await import('@tauri-apps/plugin-fs');
    _fs = {
      appDataDir: path.appDataDir,
      join: path.join,
      readTextFile: plugin.readTextFile,
      writeTextFile: plugin.writeTextFile,
      mkdir: plugin.mkdir,
      exists: plugin.exists,
    };
  } catch {
    _fs = null;
  }
  return _fs;
}

let _ledger: Promise<TrustLedger> | null = null;

async function ledgerPath(f: FsLike): Promise<string> {
  const dir = await f.appDataDir();
  return f.join(dir, LEDGER_FILE);
}

async function loadLedger(): Promise<TrustLedger> {
  const f = await fs();
  if (!f) return new TrustLedger(); // in-memory only
  try {
    const p = await ledgerPath(f);
    if (!(await f.exists(p))) return new TrustLedger();
    return TrustLedger.deserialize(JSON.parse(await f.readTextFile(p)));
  } catch {
    return new TrustLedger(); // corrupt/unreadable → start clean (fail-safe: untrusted)
  }
}

/** The in-memory ledger, loaded once. */
function ledger(): Promise<TrustLedger> {
  if (!_ledger) _ledger = loadLedger();
  return _ledger;
}

/** Best-effort write-through. Never throws — a failed persist must not break the
 *  app; worst case a trust decision doesn't survive a restart (fail-safe: the deck
 *  re-prompts, it never silently gains trust). */
async function persist(l: TrustLedger): Promise<void> {
  const f = await fs();
  if (!f) return;
  try {
    const dir = await f.appDataDir();
    await f.mkdir(dir, { recursive: true }).catch(() => {});
    await f.writeTextFile(await ledgerPath(f), JSON.stringify(l.serialize()));
  } catch { /* ignore — see doc comment */ }
}

// NOTE: load→mutate→persist is not atomic. Fine today — this is a single-window
// app and all calls are await-serialized on one in-memory ledger. If multi-window
// (multi-presentation windows are on the roadmap) ever shares this appData file,
// last-writer-wins could drop an approval; funnel all ledger mutations through one
// owner (or add file locking / merge-on-write) before that lands.
async function mutate<T>(fn: (l: TrustLedger, now: number) => T): Promise<T> {
  const l = await ledger();
  const out = fn(l, Date.now());
  await persist(l);
  return out;
}

// --- read accessors ---------------------------------------------------------

export async function deckState(token: string) {
  return (await ledger()).deckState(token, Date.now());
}
export async function isTrusted(token: string): Promise<boolean> {
  return (await ledger()).isTrusted(token, Date.now());
}
export async function isPathApproved(token: string, resolvedPath: string): Promise<boolean> {
  return (await ledger()).isApproved(token, resolvedPath, Date.now());
}
/** Provenance for one approved resolved path: { at, reason } or null. */
export async function approvalDetail(token: string, resolvedPath: string): Promise<{ at: number; reason: string } | null> {
  return (await ledger()).approvalDetail(token, resolvedPath);
}

// --- transitions (persisted) ------------------------------------------------

/** File → New: mark a freshly-created local deck trusted. `reason` records how
 *  ('file-new' by default, 'trusted' for an explicit trust of a received deck). */
export async function createTrustedDeck(token: string, reason: 'file-new' | 'trusted' = 'file-new'): Promise<void> {
  await mutate((l, now) => l.createTrusted(token, now, reason));
}
/** Approve (or re-point) one asset's resolved target on an already-trusted deck.
 *  Replaces the asset's prior entry — a relocate updates in place, never orphaning
 *  the old path. `reason` is provenance (add | relocate | relocate-folder | approve |
 *  approve-folder | trust-all). */
export async function approvePath(token: string, assetId: string, resolvedPath: string, reason: string): Promise<boolean> {
  return mutate((l, now) => l.approve(token, assetId, resolvedPath, reason, now));
}
/** Revoke ONE asset's approval (per-file "Revoke approval"), leaving trust + the rest. */
export async function unapproveAsset(token: string, assetId: string): Promise<boolean> {
  return mutate((l, now) => l.unapprove(token, assetId, now));
}
/** Record the eligible (unapproved) resolved paths surfaced by the on-open review nudge,
 *  and report how many are NEW since last open (so the toast can scope its wording). */
export async function noteEligibleOnOpen(token: string, resolvedPaths: string[]): Promise<{ total: number; newCount: number }> {
  return mutate((l, now) => l.noteEligible(token, resolvedPaths, now));
}
/** Ledger hygiene: drop approvals for assets the deck no longer references.
 *  `keepAssetIds` = the deck's current linked asset ids. Persists only when something
 *  was actually removed (avoids churning the ledger file on every save). */
export async function reconcileApprovals(token: string, keepAssetIds: string[]): Promise<number> {
  const l = await ledger();
  const removed = l.reconcile(token, keepAssetIds, Date.now());
  if (removed > 0) await persist(l);
  return removed;
}
/** Re-confirm after a TTL lapse — restore the retained approvals. */
export async function reconfirmDeck(token: string): Promise<boolean> {
  return mutate((l, now) => l.reconfirm(token, now));
}
/** Opening a trusted deck refreshes its TTL clock. Returns the resulting status. */
export async function touchOpen(token: string): Promise<string> {
  return mutate((l, now) => l.open(token, now));
}
/** Explicit revoke — drop trust AND approvals. */
export async function revokeDeck(token: string): Promise<boolean> {
  return mutate((l) => l.revoke(token));
}

/**
 * Drop the in-memory ledger cache so the next access reloads from the appData
 * file. REQUIRED for multi-window coherence: the Security window is a SEPARATE
 * webview with its own module instance + its own cache (see the NOTE on `mutate`).
 * When one window mutates the shared ledger, the other must invalidate before it
 * reads/mutates — else it acts on a stale copy (e.g. approving against a ledger
 * that predates the trust the other window just wrote → the approve no-ops).
 * Wired to `eigendeck:security-changed` (main window) and `security:init`
 * (Security window).
 */
export function invalidateLedgerCache(): void {
  _ledger = null;
}

/** Test seam: forget the cached ledger so the next call reloads from disk. */
export function _resetForTests(): void {
  _ledger = null;
  _fs = undefined;
}
