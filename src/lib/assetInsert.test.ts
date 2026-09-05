// Unit tests for the asset-insertion helper (drag-drop / file-picker path).
//
// The interesting logic here is (a) the raw-body IPC header encoding, (b) the
// size-cap precheck, (c) the trusted-deck path-approval gate, and (d) the
// storeAssetWithCollisionCheck STATE MACHINE — new vs existing vs orphan vs
// divergence, the collision-dialog accept/revert/cancel branches, session-level
// suppression, PowerPoint mode, and the whyNotLive reason strings.
//
// We keep assetTypes.mjs REAL (it's pure) so the type-gate verdicts are genuine,
// and mock every stateful boundary: Tauri invoke, the Zustand store, the hash,
// the collision dialog, preferences/toasts, and the dynamically-imported
// trust/gate/fs modules.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks for the static imports ------------------------------------------

const invokeHandlers: Record<string, (...args: unknown[]) => unknown> = {};
const invokeMock = vi.fn(async (cmd: string, ...rest: unknown[]) => {
  const h = invokeHandlers[cmd];
  if (!h) throw new Error(`unhandled invoke: ${cmd}`);
  return h(...rest);
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string])) }));

const sha256HexMock = vi.fn(async (_: Uint8Array) => 'NEWHASH');
vi.mock('./hash', () => ({ sha256Hex: (d: Uint8Array) => sha256HexMock(d) }));

// Mutable fake store state, reset per test.
let storeState: {
  presentation: { config?: { autoReloadAssets?: string | null } } | null;
  projectPath: string | null;
  updateConfig: ReturnType<typeof vi.fn>;
};
const getStateMock = vi.fn(() => storeState);
let deckToken: string | null = 'tok-1';
vi.mock('../store/presentation', () => ({
  usePresentationStore: { getState: () => getStateMock() },
  getDeckToken: () => deckToken,
}));

const invalidateRenderedAssetMock = vi.fn(async (_id: string) => {});
vi.mock('./assetRenderer', () => ({ invalidateRenderedAsset: (id: string) => invalidateRenderedAssetMock(id) }));

const showCollisionDialogMock = vi.fn(async (_r: unknown) => 'cancel' as string);
vi.mock('./collisionDialog', () => ({ showCollisionDialog: (r: unknown) => showCollisionDialogMock(r) }));

const effectiveAutoReloadMock = vi.fn(() => true);
const getPreferenceMock = vi.fn(() => 'on');
vi.mock('./preferences', () => ({
  effectiveAutoReload: (...a: unknown[]) => effectiveAutoReloadMock(...(a as [])),
  getPreference: (...a: unknown[]) => getPreferenceMock(...(a as [])),
}));

const showToastMock = vi.fn((_t: unknown) => {});
vi.mock('./toasts', () => ({ showToast: (t: unknown) => showToastMock(t) }));

const computeAssetUsageMock = vi.fn(() => ({ slideNumbers: [] as number[] }));
vi.mock('./assetUsage', () => ({ computeAssetUsage: (...a: unknown[]) => computeAssetUsageMock(...(a as [])) }));

// --- mocks for the dynamically-imported modules ----------------------------

const isTrustedMock = vi.fn(async (_t: string) => true);
const approvePathMock = vi.fn(async () => {});
vi.mock('./trustStore', () => ({
  isTrusted: (t: string) => isTrustedMock(t),
  approvePath: (...a: unknown[]) => approvePathMock(...(a as [])),
}));

const resolveAndGateMock = vi.fn(async (_p: string) => ({ ok: true, canonicalPath: '/canon/x.png' }));
vi.mock('./assetGate', () => ({ resolveAndGate: (p: string) => resolveAndGateMock(p) }));

vi.mock('./watcherRegistry', () => ({
  resolvePosixPath: (dir: string, rel: string) => `${dir}/${rel}`,
  dirname: (p: string) => p.replace(/\/[^/]*$/, ''),
}));

const statNativeMock = vi.fn(async (_: string) => ({ size: 10 }));
const readFileNativeMock = vi.fn(async (_: string) => new Uint8Array([1, 2, 3]));
vi.mock('./nativeFs', () => ({
  statNative: (p: string) => statNativeMock(p),
  readFileNative: (p: string) => readFileNativeMock(p),
}));

const saveProjectMock = vi.fn(async () => {});
vi.mock('../store/fileOps', () => ({ saveProject: () => saveProjectMock() }));

// Import AFTER the mocks are registered.
import {
  storeAssetRaw,
  readAddFileCapped,
  approveExternalAbsPath,
  storeAssetWithCollisionCheck,
} from './assetInsert';
import { MAX_ASSET_BYTES } from './assetTypes.mjs';

// --- test fixtures ----------------------------------------------------------

// A valid PNG (magic bytes) so the REAL assetTypeGate passes for `*.png`.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Records of every db_store_asset_raw call, with the decoded metadata. */
let storeCalls: Array<{ meta: Record<string, unknown>; data: unknown }>;

function decodeMetaHeader(opts: unknown): Record<string, unknown> {
  const b64 = (opts as { headers: { 'x-asset-meta': string } }).headers['x-asset-meta'];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(invokeHandlers)) delete invokeHandlers[k];
  storeState = { presentation: { config: {} }, projectPath: null, updateConfig: vi.fn() };
  deckToken = 'tok-1';
  sha256HexMock.mockResolvedValue('NEWHASH');
  effectiveAutoReloadMock.mockReturnValue(true);
  getPreferenceMock.mockReturnValue('on');
  computeAssetUsageMock.mockReturnValue({ slideNumbers: [] });
  isTrustedMock.mockResolvedValue(true);
  resolveAndGateMock.mockResolvedValue({ ok: true, canonicalPath: '/canon/x.png' });
  statNativeMock.mockResolvedValue({ size: 10 });
  readFileNativeMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
  showCollisionDialogMock.mockResolvedValue('cancel');

  storeCalls = [];
  // Default IPC dispatch: the raw store echoes the passed assetId (or mints one),
  // recording the decoded metadata for assertions.
  invokeHandlers['db_store_asset_raw'] = (data: unknown, opts: unknown) => {
    const meta = decodeMetaHeader(opts);
    storeCalls.push({ meta, data });
    return (meta.assetId as string) ?? `fresh-${storeCalls.length}`;
  };
});

// ---------------------------------------------------------------------------

describe('storeAssetRaw', () => {
  it('encodes metadata as a base64 x-asset-meta header and passes bytes as the body', async () => {
    const data = new Uint8Array([9, 8, 7]);
    const id = await storeAssetRaw(
      { path: 'a.png', mimeType: 'image/png', externalPath: '/ext/a.png', externalMtime: '123', assetId: 'A1' },
      data,
    );
    expect(id).toBe('A1');
    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0].data).toBe(data); // raw body, not nested
    expect(storeCalls[0].meta).toMatchObject({
      path: 'a.png',
      mimeType: 'image/png',
      externalPath: '/ext/a.png',
      externalMtime: '123',
      assetId: 'A1',
    });
  });

  it('round-trips non-ASCII metadata through the base64 header', async () => {
    await storeAssetRaw({ path: 'résumé—π.png', mimeType: 'image/png' }, new Uint8Array());
    expect(storeCalls[0].meta.path).toBe('résumé—π.png');
  });
});

describe('readAddFileCapped', () => {
  it('rejects an oversized file BEFORE reading it, showing the too-large toast', async () => {
    statNativeMock.mockResolvedValue({ size: MAX_ASSET_BYTES + 1 });
    const out = await readAddFileCapped('/big.mp4');
    expect(out).toBeNull();
    expect(readFileNativeMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const toast = (showToastMock.mock.calls as unknown[][])[0][0] as { kind: string; message: string };
    expect(toast.kind).toBe('error');
    expect(toast.message).toContain('512 MB');
  });

  it('reads and returns the bytes when the file is under the cap', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    readFileNativeMock.mockResolvedValue(bytes);
    const out = await readAddFileCapped('/ok.png');
    expect(out).toBe(bytes);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('falls through to the read when stat throws (real error surfaces there)', async () => {
    statNativeMock.mockRejectedValue(new Error('stat boom'));
    const bytes = new Uint8Array([7]);
    readFileNativeMock.mockResolvedValue(bytes);
    const out = await readAddFileCapped('/weird.png');
    expect(out).toBe(bytes);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('does not reject when stat reports a non-numeric size', async () => {
    statNativeMock.mockResolvedValue({ size: undefined as unknown as number });
    const out = await readAddFileCapped('/nosize.png');
    expect(out).not.toBeNull();
    expect(readFileNativeMock).toHaveBeenCalled();
  });
});

describe('approveExternalAbsPath', () => {
  it('no-ops when there is no deck token', async () => {
    deckToken = null;
    await approveExternalAbsPath('A1', '/x.png', 'add');
    expect(approvePathMock).not.toHaveBeenCalled();
    expect(isTrustedMock).not.toHaveBeenCalled();
  });

  it('no-ops when the asset id is empty', async () => {
    await approveExternalAbsPath('', '/x.png', 'add');
    expect(approvePathMock).not.toHaveBeenCalled();
  });

  it('no-ops on an untrusted deck (never records a path)', async () => {
    isTrustedMock.mockResolvedValue(false);
    await approveExternalAbsPath('A1', '/x.png', 'add');
    expect(resolveAndGateMock).not.toHaveBeenCalled();
    expect(approvePathMock).not.toHaveBeenCalled();
  });

  it('records the CANONICAL path via approvePath on a trusted deck', async () => {
    resolveAndGateMock.mockResolvedValue({ ok: true, canonicalPath: '/canon/real.png' });
    await approveExternalAbsPath('A1', '/x.png', 'relocate');
    expect(approvePathMock).toHaveBeenCalledWith('tok-1', 'A1', '/canon/real.png', 'relocate');
  });

  it('does not approve when the gate rejects the target', async () => {
    resolveAndGateMock.mockResolvedValue({ ok: false, canonicalPath: null as unknown as string });
    await approveExternalAbsPath('A1', '/x.png', 'add');
    expect(approvePathMock).not.toHaveBeenCalled();
  });

  it('swallows errors (non-fatal)', async () => {
    isTrustedMock.mockRejectedValue(new Error('trust boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(approveExternalAbsPath('A1', '/x.png', 'add')).resolves.toBeUndefined();
    expect(approvePathMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('storeAssetWithCollisionCheck — type gate', () => {
  it('refuses a bad extension: error toast, cancelled, no store', async () => {
    const r = await storeAssetWithCollisionCheck({
      path: 'thing.xyz', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(true);
    expect(r.assetId).toBe('');
    expect(storeCalls).toHaveLength(0);
    const msg = ((showToastMock.mock.calls as unknown[][])[0][0] as { message: string }).message;
    expect(msg).toContain("isn’t a supported asset type");
  });

  it('refuses bytes that do not match the extension (content-mismatch)', async () => {
    const notPng = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const r = await storeAssetWithCollisionCheck({
      path: 'thing.png', data: notPng, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(true);
    const msg = ((showToastMock.mock.calls as unknown[][])[0][0] as { message: string }).message;
    expect(msg).toContain("isn’t a valid PNG");
  });

  it('gives the demo-specific message for a non-demo .html', async () => {
    const html = new TextEncoder().encode('<html><body>not a demo</body></html>');
    const r = await storeAssetWithCollisionCheck({
      path: 'page.html', data: html, mimeType: 'text/html', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(true);
    const msg = ((showToastMock.mock.calls as unknown[][])[0][0] as { message: string }).message;
    expect(msg).toContain('Eigendeck demo');
  });
});

describe('storeAssetWithCollisionCheck — PowerPoint mode (per-pres auto-reload OFF)', () => {
  it('stores a fresh independent asset with no meta lookup and no dialog', async () => {
    storeState.presentation = { config: { autoReloadAssets: 'off' } };
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: '/ext/a.png', externalMtime: 'm',
    });
    expect(r.cancelled).toBe(false);
    expect(storeCalls).toHaveLength(1);
    // A brand-new UUID was minted (crypto.randomUUID), NOT reused from any meta.
    expect(typeof storeCalls[0].meta.assetId).toBe('string');
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
    // db_get_asset_meta_by_path must not even be consulted in PowerPoint mode.
    expect(invokeMock).not.toHaveBeenCalledWith('db_get_asset_meta_by_path', expect.anything());
  });
});

describe('storeAssetWithCollisionCheck — no existing asset', () => {
  it('stores a new asset and returns its id', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    expect(r.assetId).toBe('fresh-1');
    expect(storeCalls[0].meta.assetId).toBeUndefined(); // fresh insert, no explicit id
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
  });

  it('warns about an unsaved project when a linked asset is added with tracking on', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    storeState.projectPath = null; // unsaved
    effectiveAutoReloadMock.mockReturnValue(true);
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: '/ext/a.png', externalMtime: null,
    });
    const keys = (showToastMock.mock.calls as unknown[][]).map((c) => (c[0] as { key?: string }).key);
    expect(keys).toContain('unsaved-project-tracking');
  });

  it('does NOT warn when the asset is unlinked (externalPath null)', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('does NOT warn when the project is already saved', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    storeState.projectPath = '/proj/deck.eigendeck';
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: '/ext/a.png', externalMtime: null,
    });
    const keys = (showToastMock.mock.calls as unknown[][]).map((c) => (c[0] as { key?: string }).key);
    expect(keys).not.toContain('unsaved-project-tracking');
  });

  it('does NOT warn when effective auto-reload is off', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    effectiveAutoReloadMock.mockReturnValue(false);
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: '/ext/a.png', externalMtime: null,
    });
    const keys = (showToastMock.mock.calls as unknown[][]).map((c) => (c[0] as { key?: string }).key);
    expect(keys).not.toContain('unsaved-project-tracking');
  });
});

describe('storeAssetWithCollisionCheck — existing asset, bytes match original', () => {
  function existing(metaHash: string, originalHash: string | null) {
    invokeHandlers['db_get_asset_meta_by_path'] = () => ({
      asset_id: 'EXIST', path: 'a.png', external_path: null, external_mtime: null,
      mime_type: 'image/png', auto_reload: null, hash: metaHash,
    });
    invokeHandlers['db_get_asset_history'] = () => [
      { asset_id: 'EXIST', valid_from: 't1', valid_to: null, size: 1, hash: originalHash, mime_type: null, external_mtime: null },
    ];
  }

  it('silently stores on the existing id and invalidates when current bytes change', async () => {
    // original hash == new hash, but the CURRENT stored hash differs → invalidate.
    sha256HexMock.mockResolvedValue('ORIG');
    existing('CURRENT_DIFFERS', 'ORIG');
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    expect(storeCalls[0].meta.assetId).toBe('EXIST');
    expect(invalidateRenderedAssetMock).toHaveBeenCalledWith('EXIST');
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
  });

  it('does NOT invalidate when re-adding the identical current bytes (no-op)', async () => {
    // original == current == new → nothing changed, avoid the expensive re-render.
    sha256HexMock.mockResolvedValue('SAME');
    existing('SAME', 'SAME');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(invalidateRenderedAssetMock).not.toHaveBeenCalled();
  });

  it('treats a missing/hashless original as "matches" (no dialog)', async () => {
    existing('CUR', null); // original.hash is null
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
    expect(storeCalls[0].meta.assetId).toBe('EXIST');
  });
});

describe('storeAssetWithCollisionCheck — divergence', () => {
  // meta.hash / original.hash / new(sha) all controllable.
  function diverge(opts: { metaHash: string; originalHash: string; autoReload?: string | null; slides?: number[] }) {
    invokeHandlers['db_get_asset_meta_by_path'] = () => ({
      asset_id: 'EXIST', path: 'a.png', external_path: null, external_mtime: null,
      mime_type: 'image/png', auto_reload: opts.autoReload ?? null, hash: opts.metaHash,
    });
    invokeHandlers['db_get_asset_history'] = () => [
      { asset_id: 'EXIST', valid_from: 't2', valid_to: null, size: 1, hash: 'v2', mime_type: null, external_mtime: null },
      { asset_id: 'EXIST', valid_from: 't1', valid_to: null, size: 1, hash: opts.originalHash, mime_type: null, external_mtime: null },
    ];
    // Unique per call: acceptedProjects is a module-level Set that persists
    // across tests, so a shared id would let one test's "accept" suppress
    // another's dialog. Tests that need a STABLE id override this afterwards.
    invokeHandlers['db_get_project_id'] = () => `proj-${crypto.randomUUID()}`;
    invokeHandlers['db_restore_asset_version'] = () => undefined;
    computeAssetUsageMock.mockReturnValue({ slideNumbers: opts.slides ?? [2, 4] });
    sha256HexMock.mockResolvedValue('NEW');
  }

  it('orphan (no slides use the asset) stores a new version with NO dialog', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG', slides: [] });
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
    expect(storeCalls[0].meta.assetId).toBe('EXIST');
    expect(invalidateRenderedAssetMock).toHaveBeenCalledWith('EXIST'); // CUR != NEW
  });

  it('cancel from the dialog aborts the add (no store)', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG' });
    showCollisionDialogMock.mockResolvedValue('cancel');
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(true);
    expect(r.assetId).toBe('');
    expect(storeCalls).toHaveLength(0);
  });

  it('accept stores on the existing id, invalidates, and passes slide numbers to the dialog', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG', slides: [2, 4, 7] });
    showCollisionDialogMock.mockResolvedValue('accept');
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    expect(storeCalls[0].meta.assetId).toBe('EXIST');
    expect(invalidateRenderedAssetMock).toHaveBeenCalledWith('EXIST');
    const req = (showCollisionDialogMock.mock.calls as unknown[][])[0][0] as { slideNumbers: number[]; existingChanged: boolean };
    expect(req.slideNumbers).toEqual([2, 4, 7]);
    expect(req.existingChanged).toBe(true); // meta.hash(CUR) != original(ORIG)
  });

  it('accepting once suppresses the dialog for the rest of the session (same project)', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG' });
    invokeHandlers['db_get_project_id'] = () => 'proj-suppress-me';
    showCollisionDialogMock.mockResolvedValue('accept');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(showCollisionDialogMock).toHaveBeenCalledTimes(1);
    // Second insert with a fresh divergence on the SAME project id → no dialog.
    showCollisionDialogMock.mockClear();
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(showCollisionDialogMock).not.toHaveBeenCalled();
    expect(storeCalls[storeCalls.length - 1].meta.assetId).toBe('EXIST');
  });

  it('revert restores the original, mints a NEW asset id, and turns per-pres auto-reload OFF', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG' });
    showCollisionDialogMock.mockResolvedValue('revert');
    const restoreCalls: unknown[] = [];
    invokeHandlers['db_restore_asset_version'] = (arg: unknown) => { restoreCalls.push(arg); };
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    // Restored the existing asset to its ORIGINAL version (valid_from t1).
    expect(restoreCalls[0]).toEqual({ assetId: 'EXIST', validFrom: 't1' });
    // The new asset carries a FRESH uuid, not EXIST.
    const stored = storeCalls[storeCalls.length - 1].meta.assetId as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toBe('EXIST');
    expect(r.assetId).toBe(stored);
    // Per-presentation auto-reload flipped off.
    expect(storeState.updateConfig).toHaveBeenCalledWith({ autoReloadAssets: 'off' });
  });

  it('whyNotLive: untrusted deck yields the "isn’t trusted" reason when existing is unchanged', async () => {
    diverge({ metaHash: 'ORIG', originalHash: 'ORIG' }); // meta==original → existingChanged false
    isTrustedMock.mockResolvedValue(false);
    showCollisionDialogMock.mockResolvedValue('cancel');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    const req = (showCollisionDialogMock.mock.calls as unknown[][])[0][0] as { existingChanged: boolean; notLiveReason?: string };
    expect(req.existingChanged).toBe(false);
    expect(req.notLiveReason).toContain('isn’t trusted');
  });

  it('whyNotLive: auto-reload-off yields the "turned off" reason (trusted, unchanged)', async () => {
    diverge({ metaHash: 'ORIG', originalHash: 'ORIG' });
    isTrustedMock.mockResolvedValue(true);
    effectiveAutoReloadMock.mockReturnValue(false);
    showCollisionDialogMock.mockResolvedValue('cancel');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    const req = (showCollisionDialogMock.mock.calls as unknown[][])[0][0] as { notLiveReason?: string };
    expect(req.notLiveReason).toContain('turned off');
  });

  it('whyNotLive: neutral fallback when trusted and auto-reload on (unchanged)', async () => {
    diverge({ metaHash: 'ORIG', originalHash: 'ORIG' });
    isTrustedMock.mockResolvedValue(true);
    effectiveAutoReloadMock.mockReturnValue(true);
    showCollisionDialogMock.mockResolvedValue('cancel');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    const req = (showCollisionDialogMock.mock.calls as unknown[][])[0][0] as { notLiveReason?: string };
    expect(req.notLiveReason).toContain("isn’t auto-updating");
  });

  it('existingChanged true (meta != original) omits notLiveReason', async () => {
    diverge({ metaHash: 'CUR', originalHash: 'ORIG' });
    showCollisionDialogMock.mockResolvedValue('cancel');
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    const req = (showCollisionDialogMock.mock.calls as unknown[][])[0][0] as { existingChanged: boolean; notLiveReason?: string };
    expect(req.existingChanged).toBe(true);
    expect(req.notLiveReason).toBeUndefined();
  });
});

describe('storeAssetWithCollisionCheck — trusted-deck auto-approval side effect', () => {
  it('auto-approves the linked path after a successful add on a saved trusted deck', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    storeState.projectPath = '/proj/deck.eigendeck';
    isTrustedMock.mockResolvedValue(true);
    resolveAndGateMock.mockResolvedValue({ ok: true, canonicalPath: '/canon/a.png' });
    const r = await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: 'assets/a.png', externalMtime: null,
    });
    expect(r.cancelled).toBe(false);
    await flush(); // let the fire-and-forget autoApprove chain resolve
    expect(approvePathMock).toHaveBeenCalledWith('tok-1', r.assetId, '/canon/a.png', 'add');
  });

  it('does not auto-approve when the add was cancelled', async () => {
    // bad extension → cancelled, so no external path approval
    await storeAssetWithCollisionCheck({
      path: 'a.xyz', data: PNG, mimeType: 'image/png', externalPath: 'assets/a.xyz', externalMtime: null,
    });
    await flush();
    expect(approvePathMock).not.toHaveBeenCalled();
  });

  it('does not auto-approve when there is no linked externalPath', async () => {
    invokeHandlers['db_get_asset_meta_by_path'] = () => null;
    storeState.projectPath = '/proj/deck.eigendeck';
    await storeAssetWithCollisionCheck({
      path: 'a.png', data: PNG, mimeType: 'image/png', externalPath: null, externalMtime: null,
    });
    await flush();
    expect(approvePathMock).not.toHaveBeenCalled();
  });
});
