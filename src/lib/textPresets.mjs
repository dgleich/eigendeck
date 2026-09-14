// The text-preset style table — label + named size + fallback px size + default
// font/weight/style/color per preset. SINGLE SOURCE shared by the TS data model
// (types/presentation.ts re-exports it) and the headless CLI export
// (exportCore.mjs), which previously kept its own hand-synced copy — a copy that
// had already drifted (it was missing the `hype` preset entirely).
//
// `fontSize` is the fallback px used by code without a deck config in scope; the
// real render size comes from effectiveFontSize (textSizes.mjs). `sizeName` is
// guard-tested to match PRESET_SIZE_NAME there.
//
// `valign` is the preset's default vertical alignment. EVERY preset states one
// explicitly (not optional) so the render paths never branch on the preset name —
// they used to inline `preset === 'title' || 'footnote' ? 'bottom'` in six places
// (the #98/#85 cross-mode-drift bug class). Only `title` is 'bottom'; all others,
// footnote included, are 'top'. An element's own `verticalAlign` still overrides;
// `elementValign` (textElementHtml.mjs) resolves override → preset → 'top' floor.

import { DEFAULT_TEXT_SIZES } from './textSizes.mjs';

export const TEXT_PRESET_STYLES = {
  title: {
    label: 'Title', sizeName: 'title', fontSize: DEFAULT_TEXT_SIZES.title,
    fontFamily: "'PT Sans', sans-serif", fontWeight: '700', fontStyle: 'normal', color: '#222',
    valign: 'bottom',
  },
  body: {
    label: 'Body', sizeName: 'body', fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222',
    valign: 'top',
  },
  textbox: {
    label: 'Text Box', sizeName: 'body', fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222',
    valign: 'top',
  },
  annotation: {
    label: 'Annotation', sizeName: 'note', fontSize: DEFAULT_TEXT_SIZES.note,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'italic', color: '#2563eb',
    valign: 'top',
  },
  footnote: {
    label: 'Footnote', sizeName: 'footnote', fontSize: DEFAULT_TEXT_SIZES.footnote,
    fontFamily: "'PT Sans Narrow', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#888',
    valign: 'top',
  },
  hype: {
    // Sticky-note style: bright-yellow fill (set on creation), Shantell Sans
    // (hand-drawn) by default, dark text.
    label: 'Hype', sizeName: 'hype', fontSize: DEFAULT_TEXT_SIZES.hype,
    fontFamily: "'Shantell Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#1a1a1a',
    valign: 'top',
  },
};
