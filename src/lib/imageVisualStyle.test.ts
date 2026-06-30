import { describe, it, expect } from 'vitest';
import { imageVisualStyle } from './imageVisualStyle';

// @simplify-guard — pins the image visual-style block deduped from the editor
// (SlideElementRenderer) and present (PresentSlide) render paths. Safe to prune
// once trusted.
describe('[simplify-guard] imageVisualStyle', () => {
  it('is empty when no visual props are set', () => {
    expect(imageVisualStyle({})).toEqual({});
  });
  it('emits all four when set', () => {
    expect(imageVisualStyle({ shadow: true, borderRadius: 12, opacity: 0.5, rotation: 5 })).toEqual({
      filter: 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))',
      borderRadius: 12,
      opacity: 0.5,
      transform: 'rotate(5deg)',
    });
  });
  it('omits opacity when >= 1 and rotation/radius when falsy', () => {
    expect(imageVisualStyle({ opacity: 1, borderRadius: 0, rotation: 0 })).toEqual({});
    expect(imageVisualStyle({ opacity: 0.99 })).toEqual({ opacity: 0.99 });
  });
});
