import { describe, it, expect } from 'vitest';
import { ELEMENT_PLACEHOLDERS as PH } from './elementPlaceholders.mjs';

// @simplify-guard — the heavy-element placeholder appearance, single-sourced so
// the sidebar thumbnail / link picker / HTML export can't drift (they had: the
// notebook "NB" was #3f9142 in LinkOverlay but #86c986 everywhere else).
describe('[simplify-guard] ELEMENT_PLACEHOLDERS', () => {
  it('defines the heavy types with a consistent identity', () => {
    expect(PH.demo).toEqual({ label: 'DEMO', color: '#60a5fa', bg: '#e8f4f8', borderColor: '#93c5fd' });
    expect(PH['demo-piece']).toEqual({ label: '', color: '#7c3aed', bg: '#f0e8f8', borderColor: '#a78bfa' });
    expect(PH.notebook).toEqual({ label: 'NB', color: '#86c986', bg: '#eef7ee', borderColor: '#86c986' });
  });
  it('notebook color is one value (the #3f9142 drift is gone)', () => {
    expect(PH.notebook.color).toBe('#86c986');
  });
});
