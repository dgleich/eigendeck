import { describe, it, expect } from 'vitest';
import { describeCover } from './elementDescriptor.mjs';

// @simplify-guard — pins the unified element-descriptor path (Phase 1: cover).
// The 4 render-snapshot gates verify the per-target adapters; this verifies the
// shared descriptor's per-type rule (explicit color wins, else the resolved
// slide background).
describe('[simplify-guard] describeCover', () => {
  it('uses the explicit color when set', () => {
    expect(describeCover({ position: { x: 1, y: 2, width: 3, height: 4 }, color: '#abc' }, '#fff'))
      .toEqual({ kind: 'cover', box: { x: 1, y: 2, width: 3, height: 4 }, background: '#abc' });
  });
  it('falls back to the resolved slide background', () => {
    expect(describeCover({ position: { x: 0, y: 0, width: 10, height: 10 } }, '#1a1a2e').background)
      .toBe('#1a1a2e');
  });
});
