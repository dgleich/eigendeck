// Unit tests for the parts of src/store/db.ts the app still calls.
//
// db.ts is a vestigial SQLite facade: the Zustand store in presentation.ts is
// authoritative, and the only live caller is App.tsx's "GC assets" command
// (dbGcAssets). Tests here cover that path and dbCompact, which shares its
// JSON-payload shape. Do not add tests for the unused hooks/setters; delete
// them from db.ts instead (see Task 11 of docs/2026-09-09-coverage-branch-cleanup-plan.md).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { dbCompact, dbGcAssets } from './db';

const mockInvoke = vi.mocked(invoke);

// Read the (command, args) of the i-th invoke call in a type-safe way.
function callAt(i: number): { cmd: string; args: Record<string, unknown> } {
  const calls = mockInvoke.mock.calls as unknown[][];
  return { cmd: calls[i][0] as string, args: (calls[i][1] ?? {}) as Record<string, unknown> };
}
// The single most recent invoke.
function lastCall(): { cmd: string; args: Record<string, unknown> } {
  const calls = mockInvoke.mock.calls as unknown[][];
  return callAt(calls.length - 1);
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('write ops that parse a JSON return payload', () => {
  it('dbCompact parses the byte-stats and passes deleteAll as keepAll', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ beforeBytes: 100, afterBytes: 40, savedBytes: 60 }));
    const stats = await dbCompact(true);
    expect(stats).toEqual({ beforeBytes: 100, afterBytes: 40, savedBytes: 60 });
    expect(lastCall()).toEqual({ cmd: 'db_compact', args: { keepAll: true } });
  });

  it('dbCompact defaults deleteAll to false', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ beforeBytes: 0, afterBytes: 0, savedBytes: 0 }));
    await dbCompact();
    expect((lastCall().args as { keepAll: boolean }).keepAll).toBe(false);
  });

  it('dbGcAssets parses the full removal/byte report', async () => {
    const report = {
      removedAssets: 2,
      removedVersions: 5,
      removedCacheRows: 3,
      beforeBytes: 900,
      afterBytes: 500,
      bytesFreed: 400,
    };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(report));
    const out = await dbGcAssets();
    expect(out).toEqual(report);
    expect(lastCall().cmd).toBe('db_gc_assets');
  });
});
