import { describe, it, expect, vi } from 'vitest';
import { dispatchToolbarAction, type ToolbarHandlers } from './toolbarActions';

function handlers(): ToolbarHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    addSlide: () => calls.push('add-slide'),
    addBuild: () => calls.push('add-build'),
    present: () => calls.push('present'),
    save: () => calls.push('save'),
    export: () => calls.push('export'),
  };
}

describe('dispatchToolbarAction', () => {
  it('routes each known id to exactly its handler', () => {
    for (const [id, want] of [
      ['add-slide', 'add-slide'], ['add-build', 'add-build'],
      ['present', 'present'], ['save', 'save'], ['export', 'export'],
    ] as const) {
      const h = handlers();
      expect(dispatchToolbarAction(id, h)).toBe(true);
      expect(h.calls).toEqual([want]);
    }
  });

  it('ignores an unknown id (returns false, no handler called)', () => {
    const h = handlers();
    expect(dispatchToolbarAction('bogus', h)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('does not cross-fire handlers', () => {
    const h = handlers();
    const spy = vi.spyOn(h, 'save');
    dispatchToolbarAction('add-slide', h);
    expect(spy).not.toHaveBeenCalled();
  });
});
