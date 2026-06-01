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

export const TEXT_PRESET_STYLES: Record<TextPreset, {
  label: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
}> = {
  title: {
    label: 'Title',
    fontSize: 72,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: '700',
    fontStyle: 'normal',
    color: '#222',
  },
  body: {
    label: 'Body',
    fontSize: 48,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  textbox: {
    label: 'Text Box',
    fontSize: 48,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  annotation: {
    label: 'Annotation',
    fontSize: 32,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'italic',
    color: '#2563eb',
  },
  footnote: {
    label: 'Footnote',
    fontSize: 24,
    fontFamily: "'PT Sans Narrow', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#888',
  },
  hype: {
    label: 'Hype',
    fontSize: 96,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: '700',
    fontStyle: 'normal',
    color: '#e53e3e',
  },
};

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
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  verticalAlign?: VerticalAlign;
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
 *     Tiny app-side cost; relies on the user having the kernel
 *     installed. Default.
 *   - 'lite': JupyterLite/Pyodide running entirely in the WebView.
 *     Python-only; self-contained ("portable demo for anyone who
 *     opens the deck"). ~30 MB bundle on first use.
 *
 * All fields beyond `kind` are optional. Cascade per DESIGN_DECISIONS.md
 * "Preferences cascade" (default-setting flavor):
 *   NotebookElement.kernel ?? PresentationConfig.notebookKernel
 *     ?? app-pref default ?? { kind: 'external', baseUrl: 'http://localhost:8888',
 *                              kernelName: 'python3' }
 *
 * `token` lives on the element/deck for v1 (localhost-only realistic
 * scenario). v2 moves auth to an app-prefs server registry keyed by
 * baseUrl — decks are git-committable and tokens shouldn't be.
 */
export type NotebookKernel =
  | { kind: 'external'; baseUrl?: string; kernelName?: string; token?: string }
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
  /** Base font size in slide-pixels for code cell source. Default 32.
   *  Other notebook text (markdown, outputs, prompts) is rendered
   *  proportionally to this base. Presets: 24 (squintable), 32
   *  (readable, default), 48 (large). */
  fontSize?: number;
}

export type SlideElement =
  | TextElement
  | ImageElement
  | ArrowElement
  | DemoElement
  | DemoPieceElement
  | CoverElement
  | NotebookElement;

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
  const defaults: Record<TextPreset, ElementPosition> = {
    title:      { x: 80,  y: 20,  width: 1760, height: 200 },
    body:       { x: 80,  y: 215, width: 1760, height: 765 },
    textbox:    { x: 200, y: 300, width: 800,  height: 300 },
    annotation: { x: 200, y: 700, width: 600,  height: 150 },
    footnote:   { x: 80,  y: 1020, width: 1000, height: 44  },
    hype:       { x: 200, y: 400, width: 1520, height: 280 },
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
          createTextElement('title', { x: 160, y: 400, width: 1600, height: 140 }),
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
