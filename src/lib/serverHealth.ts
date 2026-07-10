// Aggregate Jupyter server health for the open deck — the same computation the
// topbar ServerStatusPill does, factored out so the native macOS toolbar can
// mirror it (issue #128). Returns a coarse status + a human tooltip.
//
//   green  — every kernel the deck needs has a server reached recently (≤30 min)
//   yellow — kernels matched but the server is stale (>30 min) or never tested
//   red    — at least one needed kernel has no registered server
//   gray   — nothing to report (no notebooks in the deck, or presenting)

import { useMemo } from 'react';
import { usePresentationStore } from '../store/presentation';
import { usePreference } from './preferences';
import { findServerForKernel } from './notebookKernel';
import type { Slide, PresentationConfig } from '../types/presentation';

export type ServerHealth = 'green' | 'yellow' | 'red' | 'gray';

const STALE_MS = 30 * 60 * 1000;

// Unique external kernel names the deck's notebooks need. Lite/pyodide
// notebooks need no server and are skipped; a notebook with no kernelName
// falls back to the deck default, then 'python3'. Shared by ServerStatusPill
// (the HTML topbar) and useAggregateServerHealth (the native toolbar icon) so
// the two surfaces can't drift.
export function deckExternalKernels(slides: Slide[], config: PresentationConfig | undefined): string[] {
  const names = new Set<string>();
  for (const slide of slides) {
    for (const el of slide.elements) {
      if (el.type !== 'notebook') continue;
      if (el.kernel?.kind === 'lite') continue;
      const name =
        (el.kernel?.kind === 'external' ? el.kernel.kernelName : undefined)
        ?? (config?.notebookKernel?.kind === 'external' ? config.notebookKernel.kernelName : undefined)
        ?? 'python3';
      names.add(name);
    }
  }
  return [...names];
}

export function useAggregateServerHealth(): { status: ServerHealth; tooltip: string } {
  const isPresenting = usePresentationStore((s) => s.isPresenting);
  const slides = usePresentationStore((s) => s.presentation?.slides ?? []);
  const config = usePresentationStore((s) => s.presentation?.config);
  const [servers] = usePreference('jupyterServers');

  return useMemo(() => {
    const deckKernels = deckExternalKernels(slides, config);

    if (isPresenting || deckKernels.length === 0) {
      return { status: 'gray' as const, tooltip: 'Jupyter: no live notebooks in this deck' };
    }

    const requirements = deckKernels.map((k) => ({ kernelName: k, matched: findServerForKernel(k, servers) }));
    const missing = requirements.filter((r) => r.matched == null);
    const matched = requirements.map((r) => r.matched).filter(Boolean) as { lastSeenAt?: number }[];
    const now = Date.now();
    const allFresh = matched.every((m) => m.lastSeenAt != null && now - m.lastSeenAt < STALE_MS);
    const freshCount = matched.filter((m) => m.lastSeenAt != null && now - m.lastSeenAt < STALE_MS).length;

    if (missing.length > 0) {
      return {
        status: 'red' as const,
        tooltip: `Jupyter: no server for ${missing.map((m) => m.kernelName).join(', ')} (click to configure)`,
      };
    }
    if (allFresh) {
      return { status: 'green' as const, tooltip: `Jupyter: all ${matched.length} server(s) reachable` };
    }
    return {
      status: 'yellow' as const,
      tooltip: `Jupyter: ${freshCount}/${matched.length} server(s) reachable recently (click to refresh)`,
    };
  }, [slides, config, servers, isPresenting]);
}
