import { describe, it, expect } from 'vitest';
import { nudgeDelta, zOrderDirection } from './keyboardShortcuts';

describe('nudgeDelta', () => {
  it('moves 1px per arrow without Shift', () => {
    expect(nudgeDelta('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 });
    expect(nudgeDelta('ArrowRight', false)).toEqual({ dx: 1, dy: 0 });
    expect(nudgeDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -1 });
    expect(nudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: 1 });
  });

  it('moves 10px per arrow with Shift', () => {
    expect(nudgeDelta('ArrowLeft', true)).toEqual({ dx: -10, dy: 0 });
    expect(nudgeDelta('ArrowDown', true)).toEqual({ dx: 0, dy: 10 });
  });

  it('returns null for non-arrow keys', () => {
    expect(nudgeDelta('a', false)).toBeNull();
    expect(nudgeDelta('Enter', true)).toBeNull();
  });
});

describe('zOrderDirection', () => {
  it('Cmd+] raises one step, Cmd+Shift+] to top', () => {
    expect(zOrderDirection(']', false)).toBe('up');
    expect(zOrderDirection(']', true)).toBe('top');
  });

  it('Cmd+[ lowers one step, Cmd+Shift+[ to bottom', () => {
    expect(zOrderDirection('[', false)).toBe('down');
    expect(zOrderDirection('[', true)).toBe('bottom');
  });

  it('returns null for other keys', () => {
    expect(zOrderDirection('x', false)).toBeNull();
    expect(zOrderDirection('ArrowUp', false)).toBeNull();
  });
});
