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
//
// Two entry points over ONE internal `gateRead`, so the decision logic can't fork:
//   - resolveAndGate: full read, returns the bytes (for the actual read path).
//   - resolveAndGateDecision: bounded "sniff" read, returns only the verdict + resolved
//     path, never bytes (for the report/inspector, which classify but don't use the
//     bytes). The verdict is identical to a full read because the type gate inspects at
//     most a ~512B prefix — except .ipynb, which is re-read in full (needsFullContent).

import { invoke } from '@tauri-apps/api/core';
import { assetTypeGate, extensionOf, needsFullContent } from './assetTypes.mjs';
import type { AssetKind, GateReason } from './assetTypes.mjs';

interface ResolvedRead {
  canonicalPath: string;
  bytes: number[]; // Vec<u8> over IPC
  size: number;    // FULL file size on disk (bytes may be a shorter sniff prefix)
}

// Bytes read for a TYPE DECISION. Every content sniff inspects at most a ~512B prefix
// (magic bytes / XML prolog / demo marker); 4 KB is generous headroom. .ipynb is the one
// type that parses the whole file and is re-read in full below.
const SNIFF_BYTES = 4096;

export interface GateResult {
  ok: boolean;
  /** asset kind when ok; null otherwise */
  kind: AssetKind | null;
  /** why it failed: the type-gate reason, or 'unreadable' when the file couldn't
   *  be resolved/read at all (missing, too big, not a regular file, denied). */
  reason: GateReason | 'unreadable' | null;
  /** the fully-resolved real target (null if it couldn't be resolved) */
  canonicalPath: string | null;
  /** the resolved bytes — only when ok, and only from resolveAndGate (the full read);
   *  resolveAndGateDecision never returns bytes (they may be a partial sniff). */
  bytes: Uint8Array | null;
  /** underlying error string when reason === 'unreadable' */
  error?: string;
}

/** The single resolve + read + gate. `maxBytes` undefined = full read. Returns the gate
 *  result plus whether the read was a truncated prefix of the file. Never throws. */
async function gateRead(referencePath: string, maxBytes?: number): Promise<{ result: GateResult; truncated: boolean }> {
  let res: ResolvedRead;
  try {
    res = await invoke<ResolvedRead>('resolve_and_read', { path: referencePath, maxBytes: maxBytes ?? null });
  } catch (e) {
    return { result: { ok: false, kind: null, reason: 'unreadable', canonicalPath: null, bytes: null, error: String(e) }, truncated: false };
  }
  const bytes = new Uint8Array(res.bytes);
  const gate = assetTypeGate(bytes, res.canonicalPath);
  return {
    result: { ok: gate.ok, kind: gate.kind, reason: gate.reason, canonicalPath: res.canonicalPath, bytes: gate.ok ? bytes : null },
    truncated: res.bytes.length < res.size,
  };
}

/**
 * Resolve `referencePath` to its real target, read it IN FULL, and gate on the resolved
 * path+bytes. Use this when you need the bytes (the actual read path). Never throws.
 */
export async function resolveAndGate(referencePath: string): Promise<GateResult> {
  return (await gateRead(referencePath)).result;
}

/**
 * Same resolve + gate, but reads only a bounded prefix — for callers that classify a
 * linked asset (report / inspector) but do NOT use its bytes. Avoids reading a 100 MB
 * video off disk just to learn it's a watchable video. The verdict equals a full read
 * because the type gate is prefix-bounded; a truncated full-content type (.ipynb) is
 * re-read in full so it can't disagree with the real read gate. Returns bytes: null.
 */
export async function resolveAndGateDecision(referencePath: string): Promise<GateResult> {
  const first = await gateRead(referencePath, SNIFF_BYTES);
  let result = first.result;
  if (result.canonicalPath && first.truncated && needsFullContent(extensionOf(result.canonicalPath))) {
    result = (await gateRead(referencePath)).result; // .ipynb: the sniff was too short to parse
  }
  return { ...result, bytes: null };
}
