// SINGLE SOURCE for the text type-scale: the named sizes, each preset's named
// size, and the "effective size" cascade. Pure `.mjs` so BOTH the TS data model
// (types/presentation.ts) and the headless CLI export (exportCore.mjs) share one
// copy across the .mjs/.ts boundary — the same split themeColors.mjs uses.
//
// Why this exists: exportCore's legacy text path reimplemented size resolution as
// `el.fontSize || ps.fontSize`, which ignored BOTH element.fontSizeName and the
// deck's `config.textSizes` override. So CLI-exported text using a named size, or
// a deck with a customized type scale, came out at the wrong (preset-default)
// size — the editor/app-export (effectiveFontSize) and the PDF path got it right.
// Routing the CLI through effectiveFontSize here closes that drift at the root.

/** Built-in defaults for the type scale (px). This is THE default for every deck
 *  that hasn't stored its own size for a name (via config.textSizes) — old decks
 *  included — so a change here restyles all such decks. Title is 62 (not 72): two
 *  lines of the default title fit the default 180px title box at 62
 *  (2×1.3×62≈161 < 164 content px) but overflow at 72. */
export const DEFAULT_TEXT_SIZES = {
  footnote: 24,
  note:     32,
  body:     48,
  title:    62,
  hype:     48,
};

/** Text preset → its named size in the type scale. Mirrors the `sizeName` field
 *  of TEXT_PRESET_STYLES (guard-tested to stay in sync). */
export const PRESET_SIZE_NAME = {
  title: 'title',
  body: 'body',
  textbox: 'body',
  annotation: 'note',
  footnote: 'footnote',
  hype: 'hype',
};

/** Resolve a named size against the deck override + defaults. */
export function resolveNamedSize(name, config) {
  return config?.textSizes?.[name] ?? DEFAULT_TEXT_SIZES[name];
}

/**
 * On-open migration: stamp the current default type scale into a deck that
 * predates stored sizes, so a later change to DEFAULT_TEXT_SIZES never restyles
 * an old deck (same rationale as fonts, which new decks already store in
 * createDefaultPresentation). Fills ONLY the named sizes the deck is missing;
 * any size the deck already sets is preserved. Behavior-preserving: the value
 * stamped for a missing name equals what resolveNamedSize returns for it today,
 * so nothing renders differently — the deck just now carries the scale
 * explicitly. Mutates `config` in place; returns true iff it changed anything.
 */
export function ensureStoredTextSizes(config) {
  if (!config || typeof config !== 'object') return false;
  const existing = (config.textSizes && typeof config.textSizes === 'object') ? config.textSizes : null;
  let changed = !existing;
  const out = { ...DEFAULT_TEXT_SIZES, ...(existing || {}) };
  if (existing) {
    for (const k of Object.keys(DEFAULT_TEXT_SIZES)) {
      if (typeof existing[k] !== 'number') { changed = true; break; }
    }
  }
  if (changed) config.textSizes = out;
  return changed;
}

/** Effective px size for a text preset, honoring the deck's textSizes override. */
export function effectiveTextPresetSize(preset, config) {
  return resolveNamedSize(PRESET_SIZE_NAME[preset], config);
}

/** Single resolver for "what px size should this element render at?"
 *  Cascade: explicit numeric fontSize > named size via textSizes > preset default
 *  (text) / 'note' (notebook). */
export function effectiveFontSize(element, config) {
  if (element.fontSize != null) return element.fontSize;
  if (element.fontSizeName) return resolveNamedSize(element.fontSizeName, config);
  if (element.type === 'text') return effectiveTextPresetSize(element.preset, config);
  return resolveNamedSize('note', config);
}
