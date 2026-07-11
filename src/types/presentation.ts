// The text type-scale (named sizes + the effective-size cascade) lives in the
// framework-free lib/textSizes.mjs so it is shared with the headless CLI export
// (exportCore.mjs) across the .mjs/.ts boundary. Re-exported here so the rest of
// the app keeps importing it from the data model unchanged.
import {
  DEFAULT_TEXT_SIZES, resolveNamedSize, effectiveTextPresetSize, effectiveFontSize,
} from '../lib/textSizes.mjs';
import type { NamedSize } from '../lib/textSizes.mjs';
export type { NamedSize };
export { DEFAULT_TEXT_SIZES, resolveNamedSize, effectiveTextPresetSize, effectiveFontSize };
// Text inner-box layout (line-height + padding), shared with the static exports.
export { textPresetBoxCss, textPaddingCss } from '../lib/textBox.mjs';
// Text visual-style helpers (fill / effect / box-shadow), shared with the exports.
export { textBackgroundCss, textBackgroundResolved, mixHex, TINT_STRENGTH, textEffectCss, textShadowCss, textBoxShadowCss } from '../lib/textStyle.mjs';
// Per-preset style table (label/size/font/weight/style/color), shared with the exports.
export { TEXT_PRESET_STYLES } from '../lib/textPresets.mjs';
export type { TextPresetStyle } from '../lib/textPresets.mjs';

export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}


// ============================================
// Text box presets
// ============================================

export type TextPreset = 'title' | 'body' | 'textbox' | 'annotation' | 'footnote' | 'hype';

// TEXT_PRESET_STYLES (the per-preset style table) lives in lib/textPresets.mjs so
// it is shared with the CLI export across the .mjs/.ts boundary; re-exported at
// the top of this file.

// textPresetBoxCss + textPaddingCss (the text inner-box layout) live in
// lib/textBox.mjs so they are shared with the static HTML exports across the
// .mjs/.ts boundary, and are re-exported at the top of this file.

// effectiveTextPresetSize + effectiveFontSize are defined in lib/textSizes.mjs
// (shared with the CLI export) and re-exported at the top of this file.

// ============================================
// Unified element types
// ============================================

interface BaseElement {
  id: string;
  position: ElementPosition;
  linkId?: string;   // animation link: animate between positions in presenter
  syncId?: string;   // content link: sync position/text across slides
  _linkId?: string;  // stored linkId when temporarily unlinked (for re-linking)
  _syncId?: string;  // stored syncId when temporarily unsynced (for re-syncing)
}

export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextElement extends BaseElement {
  type: 'text';
  preset: TextPreset;
  html: string;
  // Optional overrides (if user customizes beyond the preset)
  /** Named size override for THIS element. Picks from the deck's
   *  type scale rather than the preset's default. 'title' and 'hype'
   *  are intentionally excluded — title is reserved for title text
   *  elements (which already get title size from their preset), and
   *  hype is a decoration style, not a size to opt into. */
  fontSizeName?: Exclude<NamedSize, 'title' | 'hype'>;
  /** Explicit numeric override. Beats fontSizeName when both set. */
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  verticalAlign?: VerticalAlign;
  /** Fill behind the text (e.g. a caption panel over a busy background). A CSS
   *  color; combined with backgroundOpacity at render. Unset = transparent. */
  backgroundColor?: string;
  /** Opacity of backgroundColor, 0–1 (default 1). Lets text sit on a
   *  translucent panel without fading the text itself. */
  backgroundOpacity?: number;
  /** Themed box fill (#132 "card"): tint the fill RELATIVE TO THE SLIDE THEME
   *  instead of a fixed color. 'accent' mixes the theme's accent into the slide
   *  background (~15%), so a card stays colored AND contrasting on ANY theme; a
   *  hex value tints that color instead. Takes precedence over backgroundColor
   *  when set. Pairs with boxShadow + borderRadius for a Beamer-block look.
   *  Resolved per-theme at render (textBackgroundResolved). */
  boxTint?: string;
  /** Optional text decoration for legibility over busy backgrounds (#73):
   *  'shadow' = a soft drop shadow; 'glow' = a high-contrast halo (color is
   *  auto-chosen opposite the text luminance). Unset = none. */
  textEffect?: 'shadow' | 'glow';
  /** Drop shadow on the box itself (the background panel) — independent of
   *  textEffect. Only meaningful when backgroundColor is set; the inspector only
   *  offers it then. Unset = no box shadow. */
  boxShadow?: boolean;
  /** Corner radius (px, slide coords) of the background panel — lets a tinted
   *  fill read as a rounded card. Only meaningful when backgroundColor is set;
   *  the inspector only offers it then. Unset/0 = square corners. Mirrors the
   *  image element's borderRadius so both round consistently across render
   *  paths (editor, present/presenter, export). */
  borderRadius?: number;
  /** Per-side inner padding (px, slide coords) overriding the preset's default
   *  (8/12, or 0 for footnote). Pairs with backgroundColor + borderRadius to give
   *  a tinted rounded card breathing room. The inspector edits all four with an
   *  optional "link" toggle. Unset = preset default. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Rotation in degrees (clockwise) for the whole text box — the background
   *  panel tilts with the text (e.g. an angled sticky-note Hype callout, #8).
   *  Unset/0 = upright. */
  rotation?: number;
}

// textBackgroundCss / textEffectCss / textShadowCss / textBoxShadowCss (the text
// visual-style helpers) live in lib/textStyle.mjs so they're shared with the
// static HTML exports across the .mjs/.ts boundary; re-exported at the top.

/**
 * Parse a pasted color palette (#2) into a normalized list of #rrggbb hex
 * strings. Accepts colors separated by commas / whitespace / newlines /
 * semicolons, with or without a leading '#', in 3- or 6-digit hex. Expands
 * shorthand (#abc → #aabbcc), lowercases, dedupes (order-preserving), and
 * caps the count so a giant paste can't blow up the toolbar.
 */
export function parsePalette(input: string, max = 24): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[\s,;]+/)) {
    const tok = raw.trim().replace(/^#/, '');
    let hex: string | null = null;
    if (/^[0-9a-fA-F]{6}$/.test(tok)) hex = tok.toLowerCase();
    else if (/^[0-9a-fA-F]{3}$/.test(tok)) hex = tok.toLowerCase().split('').map((c) => c + c).join('');
    if (!hex) continue;
    const norm = '#' + hex;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /**
   * Stable asset_id (UUID) binding. Single source of truth for which
   * asset this element renders — display path comes from asset.path
   * via lookup, never lives on the element. Set at insert time from
   * db_store_asset; legacy elements without assetId are backfilled
   * at schema-migration time (Rust path-lookup in storage.rs).
   */
  assetId: string;
  shadow?: boolean;
  borderRadius?: number;
  opacity?: number;
  rotation?: number;
  /**
   * Source format. Auto-detected from MIME/extension on insertion.
   *   - 'raster' (default): PNG/JPEG/WebP/GIF — used directly.
   *   - 'svg' / 'pdf': vector sources rasterized on demand into
   *     asset_cache so display + thumbnails are fast and can be
   *     re-rendered at higher resolution when needed.
   * Absent value means 'raster' (backwards-compatible with v2 files).
   */
  kind?: 'raster' | 'svg' | 'pdf';
  /**
   * For sources with multiple cached variants (PDF pages, demo snapshots),
   * which variant should display here. Defaults to '_' (single-page /
   * single-variant). Reserved for future demo-snapshot work; ignored for
   * SVG and single-page PDFs.
   */
  snapshotVariant?: string;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  strokeWidth?: number;
  headSize?: number;
  /** Which ends get an arrowhead. Default 'end'. (#98) */
  heads?: 'end' | 'start' | 'both' | 'none';
  /** Stroke/fill opacity, 0–1. Default 1. (#98) */
  opacity?: number;
}

export interface DemoElement extends BaseElement {
  type: 'demo';
  /** Stable asset_id binding — see ImageElement.assetId. */
  assetId: string;
}

export interface DemoPieceElement extends BaseElement {
  type: 'demo-piece';
  piece: string;
  demoState?: Record<string, unknown>;
  /** Stable asset_id binding — see ImageElement.assetId. */
  assetId: string;
}

export interface CoverElement extends BaseElement {
  type: 'cover';
  color?: string;  // default white
}

/**
 * Jupyter kernel binding for a notebook element. Two backends:
 *   - 'external': REST + WebSocket to a user-run jupyter server.
 *     Supports any installed kernel (python3, julia-1.10, ir, ...).
 *     The notebook element ONLY says which kernel it needs; the
 *     baseUrl + token come from the per-machine server registry in
 *     PrefSchema.jupyterServers, matched by `availableKernels`. Decks
 *     therefore stay portable + git-committable — no auth artifacts.
 *   - 'lite': JupyterLite/Pyodide running entirely in the WebView.
 *     Python-only; self-contained ("portable demo for anyone who
 *     opens the deck"). ~30 MB bundle on first use.
 *
 * Cascade per DESIGN_DECISIONS.md "Preferences cascade":
 *   NotebookElement.kernel ?? PresentationConfig.notebookKernel
 *     ?? app default ?? { kind: 'external', kernelName: 'python3' }
 *
 * Server selection (the URL to dial) is NOT part of this cascade —
 * it's resolved separately from the registry by kernelName matching.
 * See src/lib/notebookKernel.ts.
 */
export type NotebookKernel =
  | { kind: 'external'; kernelName?: string }
  | { kind: 'lite' };

export interface NotebookElement extends BaseElement {
  type: 'notebook';
  /** Stable asset_id binding — .ipynb stored in assets table.
   *  See ImageElement.assetId. */
  assetId: string;
  /** Per-element kernel override; cascades through deck and app
   *  defaults when absent. See NotebookKernel docstring. */
  kernel?: NotebookKernel;
  /** Setup code run before the user's cells fire. Useful for keeping
   *  the visible cells short — imports + helper fns go here. */
  preamble?: string;
  /** Auto-run all visible cells when the slide becomes active in
   *  PresentMode. Default false (presenter triggers manually). */
  autoRun?: boolean;
  /** Optional cell whitelist (zero-indexed). When absent, all cells
   *  from the .ipynb are shown. */
  visibleCells?: number[];
  /** Syntax-highlight code cells. Default true. Set to false when
   *  the highlighter mis-identifies the language or monochrome code
   *  reads better on a particular slide. Highlighter grammar is
   *  picked from notebook.kernelspec.language; common kernels
   *  (python / julia / r / bash / cpp / rust / js / ts / sql / etc.)
   *  work out of the box, others render unhighlighted. */
  syntaxHighlight?: boolean;
  /** Show a line-number gutter in editable code cells (CodeMirror).
   *  Default false — line numbers add visual noise on a slide; opt in
   *  when referring to "line N" while presenting. */
  showLineNumbers?: boolean;
  /** Hide markdown cells, showing only code (+ outputs). Default
   *  false. For "focus on the code" decks where prose cells are just
   *  authoring scaffolding. */
  hideMarkdown?: boolean;
  /** Hide the kernel-name header row. Default false. The small busy
   *  indicator dot stays regardless — it's the only status cue a
   *  presenter needs mid-talk. */
  hideHeader?: boolean;
  /** Draw a thin frame border around the notebook. Default false —
   *  the notebook blends into the slide (theme background, no box).
   *  Turn on for a contained, card-like look. */
  showBorder?: boolean;
  /** Named size from the deck's type scale (footnote / note / body
   *  are exposed in the picker; 'title' is reserved for title text
   *  elements). When absent, falls back to 'note' (32 px default).
   *  Lower precedence than `fontSize` — explicit numeric override
   *  wins. */
  fontSizeName?: Exclude<NamedSize, 'title' | 'hype'>;
  /** Explicit numeric override (slide-pixels). When set, beats
   *  `fontSizeName`. The picker exposes this as the custom-input
   *  field alongside the named buttons. */
  fontSize?: number;
  /** Whether code cells are editable. Default false (read-only — the
   *  common "canned demo" case). Turning this ON disables file-watching
   *  (auto-reload) for the bound asset, so in-deck edits can't be
   *  clobbered by a disk-change reload; the asset keeps its
   *  external_path so a MANUAL reload still works. See
   *  docs/manual/notebook-servers.md sibling note + NotebookProperties
   *  which flips the asset's auto_reload when this toggles. */
  editable?: boolean;
  /** LEGACY (pre-recording-asset). Per-cell source edits as a deck
   *  overlay keyed by .ipynb index. Superseded by the recording asset
   *  (recordingAssetId). On load, migrateRecording folds any value
   *  here into the recording and strips this field. Do not write new
   *  values; kept only so old decks migrate. */
  cellEdits?: Record<number, string>;
  /** Eigendeck-owned "recording" asset (mime
   *  application/x-eigendeck-nb-recording+json) bound to this element.
   *  Holds the live session: source edits, recorded outputs, and
   *  live-authored (appended) cells. Versioned via the temporal asset
   *  history. The .ipynb asset stays pristine — eigendeck records, it
   *  doesn't edit the source notebook. Absent until the first thing
   *  worth recording happens. See src/lib/notebookRecording.ts. */
  recordingAssetId?: string;
}

/** A movie element: either a local video file stored as an asset (kind
 *  'file') or a hosted embed by URL (kind 'embed' — YouTube/Vimeo/PeerTube).
 *  All playback toggles default OFF; playbackRate defaults to 1. */
export interface VideoElement extends BaseElement {
  type: 'video';
  kind: 'file' | 'embed';
  /** file kind: the stored video asset (promoted assetId column). */
  assetId?: string;
  /** file kind: optional WebVTT captions sidecar asset (browser <track>). */
  captionsAssetId?: string;
  /** file kind: a label for the captions track (e.g. "English"). */
  captionsLabel?: string;
  /** embed kind: detected provider + the original pasted URL. */
  provider?: 'youtube' | 'vimeo' | 'peertube';
  url?: string;
  // --- playback options (defaults: all toggles off, rate 1) ---
  loop?: boolean;
  /** ping-pong reverse loop. FILE ONLY, best-effort (smooth only for short
   *  clips — reverse is done by reverse-seeking). */
  pingPong?: boolean;
  playbackRate?: number;
  autoplay?: boolean;
  controls?: boolean;
  muted?: boolean;
  /** Show captions: a <track> for files, provider CC param for embeds. */
  captions?: boolean;
}

export type SlideElement =
  | TextElement
  | ImageElement
  | ArrowElement
  | DemoElement
  | DemoPieceElement
  | CoverElement
  | NotebookElement
  | VideoElement;

// ============================================
// Slide and Presentation
// ============================================

export interface Slide {
  id: string;
  // Per-slide theme + font overrides (each inherits from the
  // presentation default if absent). On the storage side these are
  // bundled into a single optional `config` JSON column on slides.
  theme?: string;
  elements: SlideElement[];
  notes: string;
  groupId?: string; // slides with same groupId form a group
  // Per-slide font overrides (font package id from src/lib/fonts.ts).
  // Falls back to presentation.config.default*Font, then 'ptsans'.
  titleFont?: string;
  bodyFont?: string;
  hypeFont?: string;
}

export interface PresentationConfig {
  transition: string;
  backgroundTransition: string;
  width: number;
  height: number;
  showSlideNumber?: boolean;
  author?: string;
  venue?: string;
  mathPreamble?: string;
  // Default font package ids (see src/lib/fonts.ts FONT_PACKAGES).
  // Slides may override via Slide.{titleFont,bodyFont,hypeFont}.
  // Missing values resolve to 'ptsans' at render time.
  defaultTitleFont?: string;
  defaultBodyFont?: string;
  defaultHypeFont?: string;
  // Default monospace font package id, used by notebook code cells.
  // Falls back to 'source-code' (bundled). Notebooks ALSO inherit
  // the body font for markdown cells via the slide/presentation
  // cascade — defaultMono only governs the code path.
  defaultMonoFont?: string;
  // Deck-level overrides for the named type scale (see NamedSize).
  // Partial — any keys absent fall back to DEFAULT_TEXT_SIZES.
  // Affects text presets (via effectiveTextPresetSize) AND notebook
  // fontSizeName resolution AND anything else that picks by name.
  textSizes?: Partial<Record<NamedSize, number>>;
  // Per-presentation custom color palette (#2). Hex colors (#rrggbb) the user
  // pastes in the Deck inspector — e.g. university brand colors. Surfaced as an
  // extra swatch row in the text-color toolbar. Absent = just the built-ins.
  customPalette?: string[];
  // Per-presentation override for the file-watching auto-reload behavior.
  // 'on'/'off' override the global pref; absent = follow global. Per-asset
  // assets.auto_reload still overrides this. See effectiveAutoReload().
  autoReloadAssets?: 'on' | 'off';
  // Deck-level default kernel for notebook elements. Cascades per
  // DESIGN_DECISIONS.md "Preferences cascade" — default-setting flavor:
  // NotebookElement.kernel overrides this; absent here means "use the
  // app-pref default" then "use the hardcoded fallback (external,
  // localhost:8888, python3)".
  notebookKernel?: NotebookKernel;
  // Deck identity token for the asset-security trust ledger (docs/ASSETS-SECURITY.md).
  // A random id stamped when the app CREATES a deck (File → New / scratch). Trust is
  // keyed by this token in the app-side ledger; a received deck's token isn't in your
  // ledger, so it opens untrusted. Lives here (in config) so it round-trips through
  // the persisted config blob. Absent = a deck with no identity (never author-trusted).
  deckToken?: string;
}

export interface Presentation {
  title: string;
  theme: string;
  slides: Slide[];
  config: PresentationConfig;
}

// ============================================
// Factories
// ============================================

export function createTextElement(preset: TextPreset, overrides?: Partial<ElementPosition>): TextElement {
  // All positions are multiples of 30 — the default alignment-grid spacing — with
  // a 60px (2-cell) outer margin, so freshly-inserted elements sit on the grid
  // and the standard template breathes evenly from the slide edges.
  // Body starts flush at the title's bottom (no gap) and grows down to the
  // footnote. The footnote renders TIGHT (no padding, single line-height — see
  // textPresetBoxCss), so its 24px text fits a slim 30px box flush on the 60px
  // bottom margin.
  const defaults: Record<TextPreset, ElementPosition> = {
    title:      { x: 60,  y: 60,   width: 1800, height: 180 },
    body:       { x: 60,  y: 240,  width: 1800, height: 750 },
    textbox:    { x: 210, y: 330,  width: 810,  height: 330 },
    annotation: { x: 210, y: 720,  width: 600,  height: 150 },
    footnote:   { x: 60,  y: 990,  width: 1020, height: 30  },
    hype:       { x: 720, y: 360,  width: 570,  height: 360 },
  };

  const defaultText: Record<TextPreset, string> = {
    title: 'Title',
    body: '',
    textbox: 'Text',
    annotation: 'Annotation',
    footnote: 'Footnote',
    hype: 'HYPE!',
  };

  return {
    id: crypto.randomUUID(),
    type: 'text',
    preset,
    html: defaultText[preset],
    position: { ...defaults[preset], ...overrides },
    // Hype = sticky note: seed the bright-yellow fill (Shantell font comes from
    // the preset / hype font role) + a jaunty tilt so it reads as a tacked-on
    // callout (#8). Per-element rotation is editable in the inspector.
    ...(preset === 'hype' ? { backgroundColor: '#fde047', rotation: -4 } : {}),
  };
}

export function createDefaultPresentation(): Presentation {
  return {
    title: 'Untitled Presentation',
    theme: 'white',
    slides: [
      {
        id: crypto.randomUUID(),
        elements: [
          createTextElement('title', { x: 150, y: 390, width: 1620, height: 180 }),
        ],
        notes: '',
      },
    ],
    config: {
      transition: 'slide',
      backgroundTransition: 'fade',
      width: 1920,
      height: 1080,
      showSlideNumber: true,
      author: '',
      venue: '',
    },
  };
}

export function createBlankSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    elements: [
      createTextElement('title'),
      createTextElement('body'),
    ],
    notes: '',
  };
}

// ============================================
// Slide group helpers
// ============================================

/** Get the display slide number for a given slide index (groups share a number) */
export function getSlideNumber(slides: Slide[], index: number): number {
  let num = 0;
  for (let i = 0; i <= index; i++) {
    const slide = slides[i];
    const prev = i > 0 ? slides[i - 1] : null;
    // Increment number if this slide starts a new group or has no group
    if (!slide.groupId || !prev || prev.groupId !== slide.groupId) {
      num++;
    }
  }
  return num;
}

/** Check if a slide is a child (not the first) in its group */
export function isGroupChild(slides: Slide[], index: number): boolean {
  const slide = slides[index];
  if (!slide.groupId) return false;
  if (index === 0) return false;
  return slides[index - 1].groupId === slide.groupId;
}

/** Get all slide indices in the same group */
export function getGroupIndices(slides: Slide[], index: number): number[] {
  const slide = slides[index];
  if (!slide.groupId) return [index];
  return slides.reduce<number[]>((acc, s, i) => {
    if (s.groupId === slide.groupId) acc.push(i);
    return acc;
  }, []);
}
