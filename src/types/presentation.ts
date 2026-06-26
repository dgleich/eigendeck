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

/**
 * Named sizes in the deck's type scale. Five buckets covering every
 * size the existing TextPresets need. Other element types
 * (notebooks, future code blocks, etc.) pick from this same vocabulary
 * so the deck has ONE type scale, not parallel ones per element type.
 *
 * UX restriction: 'title' is reserved for title text elements.
 * Inspector pickers for non-title elements (notebooks, etc.) hide
 * it from the chooser — they can still use the numeric override
 * field if they want title-sized text for some reason.
 */
export type NamedSize = 'footnote' | 'note' | 'body' | 'title' | 'hype';

/** Built-in defaults for the type scale. Match the historical
 *  TextPreset.fontSize values so existing decks render identically
 *  when `PresentationConfig.textSizes` is absent. */
export const DEFAULT_TEXT_SIZES: Record<NamedSize, number> = {
  footnote: 24,
  note:     32,
  body:     48,
  title:    72,
  hype:     96,
};

/** Resolve a named size against the deck override + defaults. */
export function resolveNamedSize(
  name: NamedSize,
  config?: { textSizes?: Partial<Record<NamedSize, number>> } | null,
): number {
  return config?.textSizes?.[name] ?? DEFAULT_TEXT_SIZES[name];
}

export const TEXT_PRESET_STYLES: Record<TextPreset, {
  label: string;
  /** Named size in the deck's type scale. The numeric size at render
   *  time comes from `resolveNamedSize(sizeName, config)`. */
  sizeName: NamedSize;
  /** Fallback px size used by code that doesn't have a config in
   *  scope (e.g. element factories at insertion time). Matches
   *  DEFAULT_TEXT_SIZES[sizeName]. */
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
}> = {
  title: {
    label: 'Title',
    sizeName: 'title',
    fontSize: DEFAULT_TEXT_SIZES.title,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: '700',
    fontStyle: 'normal',
    color: '#222',
  },
  body: {
    label: 'Body',
    sizeName: 'body',
    fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  textbox: {
    label: 'Text Box',
    sizeName: 'body',
    fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  annotation: {
    label: 'Annotation',
    sizeName: 'note',
    fontSize: DEFAULT_TEXT_SIZES.note,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'italic',
    color: '#2563eb',
  },
  footnote: {
    label: 'Footnote',
    sizeName: 'footnote',
    fontSize: DEFAULT_TEXT_SIZES.footnote,
    fontFamily: "'PT Sans Narrow', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#888',
  },
  hype: {
    // Sticky-note style: bright-yellow fill (set on creation), Shantell Sans
    // (hand-drawn) by default, dark text, and a smaller size than the old
    // splashy 96px hype.
    label: 'Hype',
    sizeName: 'body',
    fontSize: DEFAULT_TEXT_SIZES.body,
    fontFamily: "'Shantell Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#1a1a1a',
  },
};

/** Inner-box layout (line spacing + padding, in px) for a text preset's
 *  rendered HTML. Footnote renders TIGHT — no padding, single line-height — so a
 *  one-line 24px footnote fills its slim box flush on the grid; every other
 *  preset keeps the comfortable 1.3 line-height + 8/12px padding. Used by BOTH
 *  the live editor (SlideElementRenderer) and the SVG/export path
 *  (TextElementSvg) so they stay WYSIWYG-identical. */
export function textPresetBoxCss(preset: TextPreset): { lineHeight: number; padY: number; padX: number } {
  if (preset === 'footnote') return { lineHeight: 1, padY: 0, padX: 0 };
  return { lineHeight: 1.3, padY: 8, padX: 12 };
}

/** Effective inner padding for a text element as a CSS shorthand ("8px 12px" or
 *  per-side "10px 24px 10px 24px"). Honors the element's `padding` override, else
 *  the preset default. Shared by editor / present / export so they stay
 *  WYSIWYG-identical. */
export function textPaddingCss(
  el: { padding?: { top: number; right: number; bottom: number; left: number } },
  preset: TextPreset,
): string {
  const p = el.padding;
  if (p) return `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
  const box = textPresetBoxCss(preset);
  return `${box.padY}px ${box.padX}px`;
}

/** Resolve the effective px size for a text preset, honoring the
 *  deck's textSizes override. Use this instead of
 *  TEXT_PRESET_STYLES[preset].fontSize anywhere a config is in scope. */
export function effectiveTextPresetSize(
  preset: TextPreset,
  config?: { textSizes?: Partial<Record<NamedSize, number>> } | null,
): number {
  return resolveNamedSize(TEXT_PRESET_STYLES[preset].sizeName, config);
}

/** Single resolver for "what px size should this element render at?"
 *  Works for any element that has the standard fontSize / fontSizeName
 *  pair (currently TextElement and NotebookElement; future code-block
 *  element will plug in here too).
 *
 *  Cascade (default-setting flavor, per DESIGN_DECISIONS.md):
 *    1. element.fontSize (explicit numeric override) — wins
 *    2. element.fontSizeName via deck's textSizes
 *    3. for text elements: the preset's default size
 *       for notebooks: 'note' (32 px default)
 */
export function effectiveFontSize(
  element:
    | { type: 'text'; preset: TextPreset; fontSize?: number; fontSizeName?: NamedSize }
    | { type: 'notebook'; fontSize?: number; fontSizeName?: NamedSize },
  config?: { textSizes?: Partial<Record<NamedSize, number>> } | null,
): number {
  if (element.fontSize != null) return element.fontSize;
  if (element.fontSizeName) return resolveNamedSize(element.fontSizeName, config);
  if (element.type === 'text') return effectiveTextPresetSize(element.preset, config);
  return resolveNamedSize('note', config);
}

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

/** Effective CSS background for a text element (colour + opacity → rgba), or
 *  undefined when no background is set. Shared by every render path (editor,
 *  present/presenter, export) so they stay consistent. */
export function textBackgroundCss(el: { backgroundColor?: string; backgroundOpacity?: number }): string | undefined {
  if (!el.backgroundColor) return undefined;
  const a = el.backgroundOpacity ?? 1;
  if (a >= 1) return el.backgroundColor;
  const hex = el.backgroundColor.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return el.backgroundColor; // non-hex colour: opacity not applied
}

/** Pick a halo color (white or black) that contrasts with `color`, for the
 *  glow effect. Non-hex / unparseable colors default to a white halo. */
function haloFor(color: string): string {
  const hex = (color || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  // Rec. 601 luma; dark text → light halo, light text → dark halo.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 140 ? '#ffffff' : '#000000';
}

/** CSS `text-shadow` value for a text element's effect (#73), or undefined for
 *  none. `color` is the resolved text color (drives the glow halo). Shared by
 *  every render path so editor / present / export stay identical. */
export function textEffectCss(effect: 'shadow' | 'glow' | undefined, color: string): string | undefined {
  if (effect === 'shadow') return '0 2px 4px rgba(0,0,0,0.45)';
  if (effect === 'glow') {
    const h = haloFor(color);
    return `0 0 3px ${h}, 0 0 6px ${h}, 0 0 10px ${h}`;
  }
  return undefined;
}

/** Shadow/glow to apply to the TEXT itself (the `textEffect` Effect control).
 *  Independent of the box shadow. */
export function textShadowCss(el: { textEffect?: 'shadow' | 'glow' }, color: string): string | undefined {
  return textEffectCss(el.textEffect, color);
}

/** CSS `box-shadow` for a text element's BOX: a drop shadow on the background
 *  panel (the explicit `boxShadow` toggle). Only when a background is set —
 *  there's no panel to shadow otherwise. */
export function textBoxShadowCss(el: { boxShadow?: boolean; backgroundColor?: string }): string | undefined {
  return el.boxShadow && el.backgroundColor ? '0 4px 14px rgba(0,0,0,0.28)' : undefined;
}

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
