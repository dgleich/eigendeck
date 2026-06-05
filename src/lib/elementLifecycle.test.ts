import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerElementLifecycle, clearElementLifecycle,
  runFreeHook, runResyncHook, runMergeHook, runCopyHook, type MergeContext,
} from './elementLifecycle';
import type { SlideElement } from '../types/presentation';

const el = (over: Partial<SlideElement> = {}): SlideElement =>
  ({ id: 'e1', type: 'notebook', position: { x: 0, y: 0, width: 1, height: 1 }, ...over } as SlideElement);

beforeEach(() => clearElementLifecycle());

describe('element lifecycle registry', () => {
  it('dispatches free/resync to the registered type only', async () => {
    const seen: string[] = [];
    registerElementLifecycle('notebook', {
      onFree: (e, id) => { seen.push(`free:${e.id}:${id}`); },
      onResync: (e) => { seen.push(`resync:${e.id}`); },
    });
    await runFreeHook(el({ id: 'nb' }), 'freed');
    await runResyncHook(el({ id: 'nb' }));
    // A type with no registration is a silent no-op.
    await runFreeHook(el({ id: 'tx', type: 'text' }), 'freed');
    expect(seen).toEqual(['free:nb:freed', 'resync:nb']);
  });

  it('runMergeHook runs once per DISTINCT type (no double-run when both match)', async () => {
    let calls = 0;
    registerElementLifecycle('notebook', { onMerge: () => { calls++; } });
    const ctx: MergeContext = {
      source: el({ id: 'a' }), target: el({ id: 'b' }),
      sharedSyncId: 'S', keep: 'auto',
    };
    await runMergeHook(ctx);
    expect(calls).toBe(1);                       // both notebooks → one call
  });

  it('runMergeHook still fires when only one side is the registered type', async () => {
    let calls = 0;
    registerElementLifecycle('notebook', { onMerge: () => { calls++; } });
    await runMergeHook({
      source: el({ id: 'a', type: 'notebook' }),
      target: el({ id: 'b', type: 'text' }),
      sharedSyncId: 'S', keep: 'auto',
    });
    expect(calls).toBe(1);
  });

  it('runCopyHook dispatches to the SOURCE element type', async () => {
    const seen: Array<[string, string]> = [];
    registerElementLifecycle('notebook', {
      onCopy: (s, c) => { seen.push([s.id, c.id]); },
    });
    await runCopyHook(el({ id: 'src' }), el({ id: 'cpy' }));
    await runCopyHook(el({ id: 't1', type: 'text' }), el({ id: 't2', type: 'text' }));  // no hook
    expect(seen).toEqual([['src', 'cpy']]);
  });

  it('awaits async hooks', async () => {
    const order: string[] = [];
    registerElementLifecycle('notebook', {
      onMerge: async () => {
        await Promise.resolve();
        order.push('hook-done');
      },
    });
    await runMergeHook({ source: el(), target: el(), sharedSyncId: 'S', keep: 'auto' });
    order.push('after-await');
    expect(order).toEqual(['hook-done', 'after-await']);
  });
});
