import { describe, it, expect } from 'vitest';
import { clamp01 } from './clamp01';

// @simplify-guard — pins the [0,1] clamp deduped from SpeakerMode + PresentMode.
describe('[simplify-guard] clamp01', () => {
  it('clamps below/above and passes through in-range', () => {
    expect(clamp01(-0.3)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});
