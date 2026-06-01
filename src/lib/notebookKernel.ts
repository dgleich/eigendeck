// Cascade-resolve the kernel settings for a NotebookElement.
// Default-setting cascade (see DESIGN_DECISIONS.md "Preferences
// cascade"): element.kernel ?? config.notebookKernel ?? app pref
// ?? hardcoded fallback.
//
// App-pref tier isn't wired through localStorage yet; for now it's
// stubbed in DEFAULT_APP_KERNEL. Wiring the pref panel is part of
// the Inspector controls work (Phase 8).

import {
  NotebookElement, NotebookKernel, PresentationConfig,
} from '../types/presentation';
import { Notebook } from './notebookFormat';

/** Hardcoded fallback when no tier has expressed a preference. */
export const DEFAULT_APP_KERNEL: NotebookKernel & { kind: 'external' } = {
  kind: 'external',
  baseUrl: 'http://localhost:8888',
  kernelName: 'python3',
};

export interface ResolvedExternal {
  kind: 'external';
  baseUrl: string;
  kernelName: string;
  token: string;
}
export interface ResolvedLite {
  kind: 'lite';
}
export type ResolvedKernel = ResolvedExternal | ResolvedLite;

/** Resolve the kernel for a notebook element. Walks the cascade and
 *  fills in any missing fields from lower tiers. The notebook's own
 *  metadata.kernelspec.name seeds kernelName when no tier specifies. */
export function resolveNotebookKernel(
  element: NotebookElement,
  config: PresentationConfig | undefined,
  notebook: Notebook | null,
): ResolvedKernel {
  // Walk the kind cascade: element → deck → app default.
  const kind =
    element.kernel?.kind
    ?? config?.notebookKernel?.kind
    ?? DEFAULT_APP_KERNEL.kind;

  if (kind === 'lite') return { kind: 'lite' };

  // External: each field falls through tiers independently so a deck
  // can set baseUrl while leaving kernelName to per-element choice.
  const elemExt = element.kernel?.kind === 'external' ? element.kernel : undefined;
  const deckExt = config?.notebookKernel?.kind === 'external'
    ? config.notebookKernel : undefined;

  return {
    kind: 'external',
    baseUrl:
      elemExt?.baseUrl
      ?? deckExt?.baseUrl
      ?? DEFAULT_APP_KERNEL.baseUrl!,
    kernelName:
      elemExt?.kernelName
      ?? deckExt?.kernelName
      ?? notebook?.kernelspecName
      ?? DEFAULT_APP_KERNEL.kernelName!,
    token:
      elemExt?.token
      ?? deckExt?.token
      ?? '',
  };
}
