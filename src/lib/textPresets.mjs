// The text-preset style table — label + named size + fallback px size + default
// font/weight/style/color per preset. SINGLE SOURCE shared by the TS data model
// (types/presentation.ts re-exports it) and the headless CLI export
// (exportCore.mjs), which previously kept its own hand-synced copy — a copy that
// had already drifted (it was missing the `hype` preset entirely).
//
// `fontSize` is the fallback px used by code without a deck config in scope; the
// real render size comes from effectiveFontSize (textSizes.mjs). `sizeName` is
// guard-tested to match PRESET_SIZE_NAME there.

import { DEFAULT_TEXT_SIZES } from './textSizes.mjs';

export const TEXT_PRESET_STYLES = {
  title: {
    label: 'Title', sizeName: 'title', fontSize: DEFAULT_TEXT_SIZES.title,
    fontFamily: "'PT Sans', sans-serif", fontWeight: '700', fontStyle: 'normal', color: '#222',
  },
  body: {
    label: 'Body', sizeName: 'body', fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222',
  },
  textbox: {
    label: 'Text Box', sizeName: 'body', fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222',
  },
  annotation: {
    label: 'Annotation', sizeName: 'note', fontSize: DEFAULT_TEXT_SIZES.note,
    fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'italic', color: '#2563eb',
  },
  footnote: {
    label: 'Footnote', sizeName: 'footnote', fontSize: DEFAULT_TEXT_SIZES.footnote,
    fontFamily: "'PT Sans Narrow', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#888',
  },
  hype: {
    // Sticky-note style: bright-yellow fill (set on creation), Shantell Sans
    // (hand-drawn) by default, dark text.
    label: 'Hype', sizeName: 'body', fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'Shantell Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#1a1a1a',
  },
};
