// The one place external-file reads and the asset-type gate are combined.
//
// resolveAndGate() is what every read site (watcher, reload-from-disk, add-asset,
// scan-on-load) should call — never `assetTypeGate` with a raw reference path.
// It resolves the reference to its REAL target via the Rust `resolve_and_read`
// primitive (following symlinks + normalizing), then runs the type gate on the
// RESOLVED path + bytes. This makes the realpath contract structural: a caller
// cannot accidentally gate an unresolved deck-supplied reference, and a symlink
// `a.png -> ~/.ssh/id_rsa` is judged as `id_rsa`. See docs/ASSETS-SECURITY.md.
//
// It does NOT consult deck-trust or approval — that's a separate layer the caller
// applies (a read only happens for a trusted deck + approved path). This module is
// strictly the resolve + type-gate step.

import { invoke } from '@tauri-apps/api/core';
import { assetTypeGate } from './assetTypes.mjs';
import type { AssetKind, GateReason } from './assetTypes.mjs';

interface ResolvedRead {
  canonicalPath: string;
  bytes: number[]; // Vec<u8> over IPC
}

export interface GateResult {
  ok: boolean;
  /** asset kind when ok; null otherwise */
  kind: AssetKind | null;
  /** why it failed: the type-gate reason, or 'unreadable' when the file couldn't
   *  be resolved/read at all (missing, too big, not a regular file, denied). */
  reason: GateReason | 'unreadable' | null;
  /** the fully-resolved real target (null if it couldn't be resolved) */
  canonicalPath: string | null;
  /** the resolved bytes — only when ok (so callers can't act on rejected bytes) */
  bytes: Uint8Array | null;
  /** underlying error string when reason === 'unreadable' */
  error?: string;
}

/**
 * Resolve `referencePath` to its real target, read it, and gate on the resolved
 * path+bytes. Returns ok:false with a reason on any failure — never throws.
 */
export async function resolveAndGate(referencePath: string): Promise<GateResult> {
  let res: ResolvedRead;
  try {
    res = await invoke<ResolvedRead>('resolve_and_read', { path: referencePath });
  } catch (e) {
    return { ok: false, kind: null, reason: 'unreadable', canonicalPath: null, bytes: null, error: String(e) };
  }
  const bytes = new Uint8Array(res.bytes);
  const gate = assetTypeGate(bytes, res.canonicalPath);
  return {
    ok: gate.ok,
    kind: gate.kind,
    reason: gate.reason,
    canonicalPath: res.canonicalPath,
    bytes: gate.ok ? bytes : null,
  };
}
