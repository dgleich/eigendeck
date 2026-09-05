// Unit tests for the aggregate Jupyter server-health computation (issue #128).
//
// Two exported surfaces:
//   - deckExternalKernels(): pure — collects the unique external kernel names a
//     deck's notebooks require, applying the lite-skip + cascade-to-python3 rules.
//   - useAggregateServerHealth(): the React hook that maps those requirements
//     against the registered servers into a coarse green/yellow/red/gray status
//     plus a human tooltip. We drive it with a mocked store + preference so the
//     status/tooltip classification (the ~29 lines of real logic) is exercised
//     across every branch. findServerForKernel stays REAL — it's pure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Slide, PresentationConfig, SlideElement } from '../types/presentation';
import type { JupyterServerEntry } from './preferences';

// --- Mock the store + preference boundaries (both are React hooks). ----------
// usePresentationStore is a selector hook: it's called as store((s) => s.field).
// We back it with a mutable `storeState` the tests set per-case.
interface StoreState {
  isPresenting: boolean;
  presentation?: { slides: Slide[]; config?: PresentationConfig };
}
let storeState: StoreState;
let servers: JupyterServerEntry[];

vi.mock('../store/presentation', () => ({
  usePresentationStore: (selector: (s: StoreState) => unknown) => selector(storeState),
}));
vi.mock('./preferences', () => ({
  usePreference: (key: string) => {
    if (key !== 'jupyterServers') throw new Error(`unexpected preference ${key}`);
    return [servers, vi.fn()];
  },
}));

import { deckExternalKernels, useAggregateServerHealth } from './serverHealth';

const STALE_MS = 30 * 60 * 1000;

// --- Tiny fixture builders ---------------------------------------------------
let elId = 0;
function nb(kernel?: SlideElement extends never ? never : unknown): SlideElement {
  // Build a minimal notebook element; only `type` + `kernel` matter here.
  elId += 1;
  return { id: `el-${elId}`, type: 'notebook', kernel } as unknown as SlideElement;
}
function nonNotebook(): SlideElement {
  elId += 1;
  return { id: `el-${elId}`, type: 'text' } as unknown as SlideElement;
}
function slide(elements: SlideElement[]): Slide {
  return { id: `s-${elId}`, elements } as unknown as Slide;
}
function externalKernel(kernelName?: string) {
  return { kind: 'external' as const, kernelName };
}
function liteKernel() {
  return { kind: 'lite' as const };
}
function server(availableKernels: string[] | undefined, lastSeenAt?: number): JupyterServerEntry {
  return { name: 'srv', baseUrl: 'http://h:8888', availableKernels, lastSeenAt } as unknown as JupyterServerEntry;
}

// =============================================================================
describe('deckExternalKernels', () => {
  beforeEach(() => { elId = 0; });

  it('returns [] for a deck with no notebook elements', () => {
    const slides = [slide([nonNotebook(), nonNotebook()])];
    expect(deckExternalKernels(slides, undefined)).toEqual([]);
  });

  it('returns [] for an empty deck', () => {
    expect(deckExternalKernels([], undefined)).toEqual([]);
  });

  it('skips lite notebooks (they need no server)', () => {
    const slides = [slide([nb(liteKernel())])];
    expect(deckExternalKernels(slides, undefined)).toEqual([]);
  });

  it('uses the element external kernelName when present', () => {
    const slides = [slide([nb(externalKernel('julia-1.10'))])];
    expect(deckExternalKernels(slides, undefined)).toEqual(['julia-1.10']);
  });

  it('falls back to the deck config kernelName when the element has none', () => {
    const config = { notebookKernel: externalKernel('ir') } as unknown as PresentationConfig;
    const slides = [slide([nb(externalKernel(undefined))])];
    expect(deckExternalKernels(slides, config)).toEqual(['ir']);
  });

  it('falls back to python3 when neither element nor config names a kernel', () => {
    const slides = [slide([nb(externalKernel(undefined))])];
    expect(deckExternalKernels(slides, undefined)).toEqual(['python3']);
  });

  it('falls back to python3 for a notebook element with no kernel binding at all', () => {
    const slides = [slide([nb(undefined)])];
    expect(deckExternalKernels(slides, undefined)).toEqual(['python3']);
  });

  it('does not use a lite config default for an element that itself names a kernel', () => {
    const config = { notebookKernel: liteKernel() } as unknown as PresentationConfig;
    const slides = [slide([nb(externalKernel('python3'))])];
    expect(deckExternalKernels(slides, config)).toEqual(['python3']);
  });

  it('ignores a lite config default when an external element has no name (→ python3, not lite)', () => {
    const config = { notebookKernel: liteKernel() } as unknown as PresentationConfig;
    const slides = [slide([nb(externalKernel(undefined))])];
    expect(deckExternalKernels(slides, config)).toEqual(['python3']);
  });

  it('deduplicates repeated kernel names across slides and elements', () => {
    const slides = [
      slide([nb(externalKernel('python3')), nb(externalKernel('julia-1.10'))]),
      slide([nb(externalKernel('python3'))]),
    ];
    expect(deckExternalKernels(slides, undefined)).toEqual(['python3', 'julia-1.10']);
  });

  it('collects a mix of external names while skipping lite and non-notebook elements', () => {
    const slides = [
      slide([nb(liteKernel()), nonNotebook(), nb(externalKernel('ir'))]),
      slide([nb(externalKernel('python3'))]),
    ];
    expect(deckExternalKernels(slides, undefined)).toEqual(['ir', 'python3']);
  });
});

// =============================================================================
describe('useAggregateServerHealth', () => {
  beforeEach(() => {
    elId = 0;
    storeState = { isPresenting: false, presentation: { slides: [], config: undefined } };
    servers = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  const run = () => renderHook(() => useAggregateServerHealth()).result.current;

  it('is gray with no notebooks in the deck', () => {
    const res = run();
    expect(res.status).toBe('gray');
    expect(res.tooltip).toMatch(/no live notebooks/);
  });

  it('is gray while presenting even when the deck needs a kernel', () => {
    storeState = {
      isPresenting: true,
      presentation: { slides: [slide([nb(externalKernel('python3'))])], config: undefined },
    };
    servers = [server(['python3'], Date.now())];
    const res = run();
    expect(res.status).toBe('gray');
    expect(res.tooltip).toMatch(/no live notebooks/);
  });

  it('is red when a needed kernel has no registered server', () => {
    storeState = {
      isPresenting: false,
      presentation: { slides: [slide([nb(externalKernel('python3'))])], config: undefined },
    };
    servers = []; // nothing advertises python3
    const res = run();
    expect(res.status).toBe('red');
    expect(res.tooltip).toBe('Jupyter: no server for python3 (click to configure)');
  });

  it('lists every missing kernel in the red tooltip', () => {
    storeState = {
      isPresenting: false,
      presentation: {
        slides: [slide([nb(externalKernel('python3')), nb(externalKernel('julia-1.10'))])],
        config: undefined,
      },
    };
    servers = []; // both missing
    const res = run();
    expect(res.status).toBe('red');
    expect(res.tooltip).toBe('Jupyter: no server for python3, julia-1.10 (click to configure)');
  });

  it('is red if ANY needed kernel is missing even when others match', () => {
    storeState = {
      isPresenting: false,
      presentation: {
        slides: [slide([nb(externalKernel('python3')), nb(externalKernel('ir'))])],
        config: undefined,
      },
    };
    servers = [server(['python3'], Date.now())]; // ir has no server
    const res = run();
    expect(res.status).toBe('red');
    expect(res.tooltip).toBe('Jupyter: no server for ir (click to configure)');
  });

  it('is green when every matched server was seen within the stale window', () => {
    storeState = {
      isPresenting: false,
      presentation: {
        slides: [slide([nb(externalKernel('python3')), nb(externalKernel('ir'))])],
        config: undefined,
      },
    };
    // Two distinct servers, each fresh.
    servers = [
      server(['python3'], Date.now() - 1000),
      server(['ir'], Date.now() - 2000),
    ];
    const res = run();
    expect(res.status).toBe('green');
    expect(res.tooltip).toBe('Jupyter: all 2 server(s) reachable');
  });

  it('is yellow when a matched server is stale (>30 min)', () => {
    storeState = {
      isPresenting: false,
      presentation: { slides: [slide([nb(externalKernel('python3'))])], config: undefined },
    };
    servers = [server(['python3'], Date.now() - STALE_MS - 1)];
    const res = run();
    expect(res.status).toBe('yellow');
    expect(res.tooltip).toBe('Jupyter: 0/1 server(s) reachable recently (click to refresh)');
  });

  it('is yellow when a matched server was never tested (no lastSeenAt)', () => {
    storeState = {
      isPresenting: false,
      presentation: { slides: [slide([nb(externalKernel('python3'))])], config: undefined },
    };
    servers = [server(['python3'], undefined)];
    const res = run();
    expect(res.status).toBe('yellow');
    expect(res.tooltip).toBe('Jupyter: 0/1 server(s) reachable recently (click to refresh)');
  });

  it('reports the fresh/total ratio in the yellow tooltip when some are fresh', () => {
    storeState = {
      isPresenting: false,
      presentation: {
        slides: [slide([nb(externalKernel('python3')), nb(externalKernel('ir'))])],
        config: undefined,
      },
    };
    servers = [
      server(['python3'], Date.now() - 1000),          // fresh
      server(['ir'], Date.now() - STALE_MS - 1),       // stale
    ];
    const res = run();
    expect(res.status).toBe('yellow');
    expect(res.tooltip).toBe('Jupyter: 1/2 server(s) reachable recently (click to refresh)');
  });

  it('treats a server seen exactly at the stale boundary as NOT fresh (strict <)', () => {
    storeState = {
      isPresenting: false,
      presentation: { slides: [slide([nb(externalKernel('python3'))])], config: undefined },
    };
    // now - lastSeenAt === STALE_MS → not < STALE_MS → stale.
    servers = [server(['python3'], Date.now() - STALE_MS)];
    const res = run();
    expect(res.status).toBe('yellow');
    expect(res.tooltip).toBe('Jupyter: 0/1 server(s) reachable recently (click to refresh)');
  });

  it('collapses two notebooks needing the same kernel to one matched server (green)', () => {
    storeState = {
      isPresenting: false,
      presentation: {
        slides: [slide([nb(externalKernel('python3')), nb(externalKernel('python3'))])],
        config: undefined,
      },
    };
    servers = [server(['python3'], Date.now() - 500)];
    const res = run();
    expect(res.status).toBe('green');
    expect(res.tooltip).toBe('Jupyter: all 1 server(s) reachable');
  });
});
