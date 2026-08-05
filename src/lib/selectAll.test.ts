import { describe, it, expect } from 'vitest';
import { selectAllTarget } from './selectAll';

// Regression net for the Cmd+A / "Select All" decision (#173): it must select
// slide ELEMENTS (multi / single / slide-when-empty) on the canvas, and defer to
// FIELD-text selection when a text field is focused — never the browser's DOM
// select-all. The DOM/store side effects live in App.selectAllAction; this is the
// pure branch logic.
describe('selectAllTarget (#173)', () => {
  it('focus in a text field → select the field text (regardless of elements)', () => {
    expect(selectAllTarget(true, [])).toEqual({ kind: 'field' });
    expect(selectAllTarget(true, ['a', 'b', 'c'])).toEqual({ kind: 'field' });
  });

  it('canvas + multiple elements → multi-select ALL of them', () => {
    expect(selectAllTarget(false, ['a', 'b', 'c'])).toEqual({ kind: 'multi', ids: ['a', 'b', 'c'] });
  });

  it('canvas + exactly one element → select that element', () => {
    expect(selectAllTarget(false, ['only'])).toEqual({ kind: 'element', id: 'only' });
  });

  it('canvas + no elements → fall back to selecting the slide', () => {
    expect(selectAllTarget(false, [])).toEqual({ kind: 'slide' });
  });

  it('does not alias the input ids array (copies)', () => {
    const ids = ['a', 'b'];
    const r = selectAllTarget(false, ids);
    expect(r).toEqual({ kind: 'multi', ids: ['a', 'b'] });
    if (r.kind === 'multi') expect(r.ids).not.toBe(ids);
  });
});
