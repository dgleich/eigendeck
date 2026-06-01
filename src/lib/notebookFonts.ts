// Resolve the font packages used to render a notebook element.
//
// Two roles:
//   - 'prose': markdown cells, plain-text outputs. Inherits the
//     slide/presentation body font (default 'ptsans').
//   - 'code':  code cell source + stream/error outputs. Falls back
//     to PresentationConfig.defaultMonoFont, then 'source-code'.
//
// Default-setting cascade per DESIGN_DECISIONS.md "Preferences cascade".
// Prose font follows the EXISTING body-font cascade (slide → deck →
// 'ptsans') so a notebook on a styled slide picks up the slide's
// typography without per-element wiring.

import {
  FONT_PACKAGES, resolveFontPackage, type FontPackage,
} from './fonts';
import type { Slide, PresentationConfig } from '../types/presentation';

const DEFAULT_MONO_ID = 'source-code';

export function fontForNotebookProse(
  slide: Pick<Slide, 'bodyFont'> | null | undefined,
  config: Pick<PresentationConfig, 'defaultBodyFont'> | null | undefined,
): FontPackage {
  return resolveFontPackage(
    slide?.bodyFont ?? config?.defaultBodyFont,
  );
}

export function fontForNotebookCode(
  config: Pick<PresentationConfig, 'defaultMonoFont'> | null | undefined,
): FontPackage {
  // resolveFontPackage falls back to 'ptsans' if the id is absent —
  // that's wrong for code. Explicit fallback to 'source-code' here.
  const id = config?.defaultMonoFont ?? DEFAULT_MONO_ID;
  return resolveFontPackage(id);
}

/** List the font packages eligible to be used as the deck-level
 *  monospace default. v1 returns the whole set — the picker will
 *  filter visually. Future: tag packages as `kind: 'mono' | 'sans' |
 *  'serif'` in the registry and filter here. */
export function listMonoEligible(): FontPackage[] {
  // For now, return all packages but with 'source-code' first.
  const all = [...FONT_PACKAGES];
  return all.sort((a, b) => {
    if (a.id === DEFAULT_MONO_ID) return -1;
    if (b.id === DEFAULT_MONO_ID) return 1;
    return 0;
  });
}
