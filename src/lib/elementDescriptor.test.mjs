import { describe, it, expect } from 'vitest';
import { describeCover, imageVisuals } from './elementDescriptor.mjs';

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

// @simplify-guard — the single source of image visual-style predicates, shared
// by the React adapter (imageVisualStyle) and the HTML export (exportCore). The
// render-snapshot gates pin the per-target forms; this pins the shared rule.
describe('[simplify-guard] imageVisuals', () => {
  it('is all-undefined when no visual props are set', () => {
    expect(imageVisuals({})).toEqual({ shadow: undefined, borderRadius: undefined, opacity: undefined, transform: undefined });
  });
  it('resolves all four when set', () => {
    expect(imageVisuals({ shadow: true, borderRadius: 12, opacity: 0.5, rotation: 5 })).toEqual({
      shadow: 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))',
      borderRadius: 12,
      opacity: 0.5,
      transform: 'rotate(5deg)',
    });
  });
  it('drops opacity >= 1 and falsy radius/rotation', () => {
    expect(imageVisuals({ opacity: 1, borderRadius: 0, rotation: 0 }))
      .toEqual({ shadow: undefined, borderRadius: undefined, opacity: undefined, transform: undefined });
  });
});
