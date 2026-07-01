// Tests for storeAssetWithCollisionCheck's invalidation gating.
//
// Re-adding the same bytes that are already current MUST NOT call
// invalidateRenderedAsset — that nukes the asset_cache, which means
// the next render re-parses the asset from scratch. For Asset 2.pdf
// (the 40+ second pdfium worst case) that's a multi-second pause on
// what should be a no-op file-picker re-add. If anyone simplifies the
// three `if (newHash !== meta.hash)` guards back to unconditional
// invalidation, the bug reappears silently — no error, just a
// surprising stall — so these tests are the regression net.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { webcrypto } from 'node:crypto';

// Mock the modules with side effects before importing the
// system-under-test, so the SUT picks up the mocked versions.
vi.mock('./assetRenderer', () => ({
  invalidateRenderedAsset: vi.fn(async () => {}),
}));
vi.mock('./toasts', () => ({
  showToast: vi.fn(),
}));
vi.mock('./collisionDialog', () => ({
  showCollisionDialog: vi.fn(async () => 'accept' as const),
}));
vi.mock('./assetUsage', () => ({
  computeAssetUsage: vi.fn(() => new Map()),
}));
vi.mock('../store/presentation', () => ({
  usePresentationStore: {
    getState: () => ({ projectPath: '/tmp/test.eigendeck', presentation: { config: {} } }),
  },
}));
vi.mock('./preferences', () => ({
  effectiveAutoReload: () => false,
  getPreference: () => null,
}));

import { storeAssetWithCollisionCheck } from './assetInsert';
import { invalidateRenderedAsset } from './assetRenderer';

const mockedInvoke = vi.mocked(invoke);
const mockedInvalidate = vi.mocked(invalidateRenderedAsset);

// jsdom's crypto.subtle.digest rejects sliced ArrayBuffers across
// realms (which is exactly what sha256Hex passes it). Real browsers
// don't have this bug; it's a jsdom-only issue. Monkeypatch the
// digest method to forward to the real (pre-replacement) implementation
// with a clean copy of the input bytes — sidesteps the cross-realm
// instanceof check. Capture the bound reference BEFORE the assignment;
// otherwise our wrapper calls itself.
beforeAll(() => {
  const realDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  globalThis.crypto.subtle.digest = (async (algo: AlgorithmIdentifier, data: BufferSource) => {
    const view = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return realDigest(algo, new Uint8Array(view));
  }) as typeof globalThis.crypto.subtle.digest;
});

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvalidate.mockReset();
});

describe('storeAssetWithCollisionCheck — invalidation gating', () => {
  it('re-adding IDENTICAL bytes to existing asset does NOT invalidate cache', async () => {
    // Compute the hash of the bytes we'll "re-add" so the mock returns
    // it consistently for both `meta.hash` (current) and the
    // single-version history (original).
    // Valid PNG magic — the add-gate now validates that bytes match the .png
    // extension, so fixtures must be real (this test is about invalidation, not type).
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_path') {
        return { asset_id: 'existing-id', path: 'images/x.png', external_path: null, external_mtime: null, mime_type: 'image/png', auto_reload: null, hash };
      }
      if (cmd === 'db_get_asset_history') {
        // Single-version history; original = current; original.hash === newHash.
        return [{ asset_id: 'existing-id', valid_from: 't0', valid_to: null, size: bytes.length, hash, mime_type: 'image/png', external_mtime: null }];
      }
      // storeAssetRaw → invoke('db_store_asset_raw', dataUint8Array, {headers}).
      // The mock keys on the command name (first arg), so the new call
      // shape (cmd, data, options) still resolves here.
      if (cmd === 'db_store_asset_raw') return 'existing-id';
      if (cmd === 'db_get_project_id') return 'project-1';
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await storeAssetWithCollisionCheck({
      path: 'images/x.png',
      data: bytes,
      mimeType: 'image/png',
      externalPath: 'images/x.png',
      externalMtime: null,
    });

    expect(result.cancelled).toBe(false);
    expect(result.assetId).toBe('existing-id');
    // New call shape: bytes are the raw 2nd arg (memcpy body), metadata
    // rides in the x-asset-meta header — not the old (cmd, {path,data,…}).
    expect(mockedInvoke).toHaveBeenCalledWith(
      'db_store_asset_raw',
      bytes,
      expect.objectContaining({ headers: expect.objectContaining({ 'x-asset-meta': expect.any(String) }) }),
    );
    // The critical assertion: cache was NOT invalidated because the
    // bytes didn't change. If this regresses, every no-op re-add of a
    // big PDF triggers a 40s pdfium re-parse on next render.
    expect(mockedInvalidate).not.toHaveBeenCalled();
  });

  it('reverting current bytes to original (different from current) DOES invalidate', async () => {
    // Different hash for "current" (drift from original); new bytes
    // match the ORIGINAL hash. This is the "user is reverting to the
    // file they originally added" scenario. db_store_asset writes
    // the original bytes back, and the cache MUST be invalidated
    // because the bytes did change (current → original).
    const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8]); // valid PNG magic
    const originalHashBuf = await crypto.subtle.digest('SHA-256', originalBytes);
    const originalHash = Array.from(new Uint8Array(originalHashBuf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const driftedCurrentHash = 'deadbeef'.repeat(8);  // any non-matching hash

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_path') {
        return { asset_id: 'existing-id', path: 'images/x.png', external_path: null, external_mtime: null, mime_type: 'image/png', auto_reload: null, hash: driftedCurrentHash };
      }
      if (cmd === 'db_get_asset_history') {
        return [
          { asset_id: 'existing-id', valid_from: 't1', valid_to: null, size: 5, hash: driftedCurrentHash, mime_type: 'image/png', external_mtime: null },
          { asset_id: 'existing-id', valid_from: 't0', valid_to: 't1', size: 5, hash: originalHash, mime_type: 'image/png', external_mtime: null },
        ];
      }
      // storeAssetRaw → invoke('db_store_asset_raw', dataUint8Array, {headers}).
      // The mock keys on the command name (first arg), so the new call
      // shape (cmd, data, options) still resolves here.
      if (cmd === 'db_store_asset_raw') return 'existing-id';
      if (cmd === 'db_get_project_id') return 'project-1';
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await storeAssetWithCollisionCheck({
      path: 'images/x.png',
      data: originalBytes,  // matches ORIGINAL hash, not current
      mimeType: 'image/png',
      externalPath: 'images/x.png',
      externalMtime: null,
    });

    // Invalidate IS expected here: bytes changed (current → original).
    expect(mockedInvalidate).toHaveBeenCalledWith('existing-id');
  });
});
