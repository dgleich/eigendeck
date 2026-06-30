import { describe, it, expect } from 'vitest';
import { describeCover, imageVisuals, describeArrow } from './elementDescriptor.mjs';

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

// @simplify-guard — the single source of arrow defaults + geometry, shared by all
// six render targets. Pins the ONE canonical default (matching SlideEditor's
// creation defaults) that closes the #105 cross-target divergence. The render
// snapshots pin the per-target output; this pins the shared rule.
describe('[simplify-guard] describeArrow', () => {
  const ep = { x1: 0, y1: 0, x2: 100, y2: 0 };
  it('defaults to the canonical creation style (#2563eb / 4 / 16) when omitted', () => {
    const a = describeArrow({ ...ep });
    expect(a.color).toBe('#2563eb');
    expect(a.strokeWidth).toBe(4);
    expect(a.headSize).toBe(16);
    expect(a.geo).toBeTruthy(); // geometry computed once, in the descriptor
  });
  it('lets explicit values win and preserves opacity/heads', () => {
    const a = describeArrow({ ...ep, color: '#e53e3e', strokeWidth: 8, headSize: 20, heads: 'both', opacity: 0.5 });
    expect(a).toMatchObject({ color: '#e53e3e', strokeWidth: 8, headSize: 20, heads: 'both', opacity: 0.5 });
  });
});
