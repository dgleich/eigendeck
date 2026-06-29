import { describe, it, expect } from 'vitest';
import { offsetElement } from './offsetElement';
import type { SlideElement } from '../types/presentation';

// @simplify-guard — pins the element-offset logic deduped from 3 copies in
// App.tsx (duplicate / multi-duplicate / same-slide paste). Safe to prune once
// trusted.
describe('[simplify-guard] offsetElement', () => {
  it('moves an arrow by shifting all four endpoints', () => {
    const a = { id: 'a', type: 'arrow', x1: 10, y1: 20, x2: 30, y2: 40, position: { x: 0, y: 0, width: 0, height: 0 } } as unknown as SlideElement;
    offsetElement(a, 40, 40);
    expect(a).toMatchObject({ x1: 50, y1: 60, x2: 70, y2: 80 });
  });
  it('moves a non-arrow by shifting its position box', () => {
    const t = { id: 't', type: 'text', preset: 'body', html: '', position: { x: 100, y: 200, width: 300, height: 50 } } as unknown as SlideElement;
    offsetElement(t, 40, 40);
    expect((t as { position: { x: number; y: number } }).position).toEqual({ x: 140, y: 240, width: 300, height: 50 });
  });
});
