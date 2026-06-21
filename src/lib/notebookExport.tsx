// App-side builder for the STATIC HTML export of a notebook element.
//
// Renders the SAME <NotebookCells> the live view uses (no `live`
// controller → read-only: no run buttons, no editor, outputs/exec-counts
// from the merged model), so the export cannot drift from the live view.
//
// Because renderToStaticMarkup can't run the async useEffects that
// CodeCell (syntax highlight) and MarkdownCell (marked) rely on, those
// are resolved UP FRONT here and passed in as pre-rendered maps. The
// result is wrapped in a srcdoc <iframe> sized to the element box by the
// caller (exportCore), with the same --nb-* CSS variables NotebookContent
// sets and the notebook.css stylesheet inlined.

import { renderToStaticMarkup } from 'react-dom/server';
// Vite inline import: the notebook stylesheet as a raw string, to embed
// in the iframe srcdoc. (?inline yields the processed CSS as a string;
// notebook.css has no url()/@import deps so this is the full sheet.)
import nbCss from '../components/notebook/notebook.css?inline';
import { NotebookCells } from '../components/notebook/NotebookCells';
import { loadMarked } from '../components/notebook/MarkdownCell';
import { filterMerged } from '../components/notebook/NotebookContent';
import { parseNotebookBytes } from './notebookParser';
import { mergeNotebook } from './notebookOverlay';
import { parseOverlay, emptyOverlay, Overlay } from './notebookOverlay';
import { highlightCode } from './syntaxHighlight';
import { fontForNotebookProse, fontForNotebookCode } from './notebookFonts';
import { resolveTheme, isDarkTheme } from './themes';
import {
  NotebookElement, Slide, Presentation, effectiveFontSize,
} from '../types/presentation';

type AssetBytes = (assetId: string) => Promise<ArrayBuffer | Uint8Array>;

function toUint8(b: ArrayBuffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** Escape a string for safe inclusion in an HTML attribute value
 *  (the iframe srcdoc). Mirrors exportCore's htmlEscapeForSrcdoc. */
function escapeSrcdoc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the inner HTML (a positioned <iframe>) for a notebook element in
 * the interactive HTML export. Returns null on failure so the caller can
 * fall back to the preview PNG / placeholder.
 *
 * The returned iframe is positioned by the CALLER (exportCore wraps it /
 * sets left/top/width/height) — here we only emit the iframe tag with the
 * srcdoc; exportCore adds the absolute positioning, consistent with how
 * the demo iframe is handled.
 */
export async function renderNotebookElementHtml(
  element: NotebookElement,
  slide: Slide,
  presentation: Presentation,
  getAssetBytes: AssetBytes,
): Promise<string> {
  // 1. Load + parse the .ipynb.
  const nb = parseNotebookBytes(toUint8(await getAssetBytes(element.assetId)));

  // 2. Load the overlay if present (owned asset keyed by the element's
  //    sync identity, mirroring useOverlay), else empty.
  const overlay = await loadOverlay(element, getAssetBytes);

  // 3. Merge + apply the element's cell filters (same as the live view).
  const merged = filterMerged(mergeNotebook(nb, overlay), element);

  // 4. Pre-resolve syntax highlight + markdown (async paths that
  //    renderToStaticMarkup can't run).
  const highlight = element.syntaxHighlight !== false;
  const language = nb.language ?? null;
  const highlights = new Map<string, string>();
  const markdowns = new Map<string, string>();
  const md = await loadMarked();
  for (const m of merged) {
    if (m.origin === 'ipynb') {
      const c = m.cell;
      if (c.kind === 'code') {
        if (highlight) {
          // Mirror CodeCell's display: strip one trailing newline.
          const display = m.source.replace(/\n$/, '');
          highlights.set(`i${c.index}`, await highlightCode(display, language));
        }
      } else if (c.kind === 'markdown') {
        markdowns.set(`i${c.index}`, await md(m.source));
      }
    } else {
      const a = m.appended;
      const key = `a${a.id}`;
      if (a.cellType === 'code') {
        if (highlight) {
          highlights.set(key, await highlightCode(a.source.replace(/\n$/, ''), language));
        }
      } else {
        markdowns.set(key, await md(a.source));
      }
    }
  }

  // 5. Render the read-only cells (no `live`).
  const baseSize = effectiveFontSize(element, presentation.config);
  const theme = resolveTheme(presentation.theme ?? 'white', slide.theme);
  const dark = isDarkTheme(theme);
  const kernelDisplayName = nb.kernelDisplayName ?? nb.kernelspecName ?? null;
  const body = renderToStaticMarkup(
    <NotebookCells
      merged={merged}
      language={language}
      highlight={highlight}
      dark={dark}
      baseSize={baseSize}
      showLineNumbers={element.showLineNumbers}
      hideHeader={element.hideHeader === true}
      kernelDisplayName={kernelDisplayName}
      highlights={highlights}
      markdowns={markdowns}
    />,
  );

  // 6. Compute the same --nb-* CSS variables + frame class NotebookContent
  //    sets, so the export matches the live typography/theme.
  const proseFont = fontForNotebookProse(slide, presentation.config);
  const codeFont = fontForNotebookCode(presentation.config);
  const tint = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)';
  const borderColor = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const vars: Record<string, string> = {
    '--nb-prose-family': proseFont.family,
    '--nb-mono-family': codeFont.family,
    '--nb-base-size': `${baseSize}px`,
    '--nb-fg': theme.text,
    '--nb-bg': theme.background,
    '--nb-code-bg': tint,
    '--nb-muted': theme.muted,
    '--nb-accent': theme.accent,
    '--nb-border': borderColor,
  };
  const styleStr = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  const frameClass = [
    'nb-frame',
    dark ? 'nb-theme-dark' : 'nb-theme-light',
    element.showBorder ? 'nb-frame--bordered' : '',
  ].filter(Boolean).join(' ');

  // 7. Assemble the iframe document. `.el-notebook` wraps the frame so the
  //    scoped `.el-notebook .nb-*` rules apply (verbatim from the app).
  //    html/body sized to fill so the .nb-body scrolls.
  const doc = `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>${nbCss}\n`
    + `html,body{margin:0;padding:0;height:100%;}`
    + `.el-notebook{height:100%;}`
    + `.el-notebook .nb-frame{height:100%;}`
    + `</style></head><body>`
    + `<div class="el-notebook">`
    + `<div class="${frameClass}" style="${styleStr}">${body}</div>`
    + `</div></body></html>`;

  return `<iframe srcdoc="${escapeSrcdoc(doc)}" sandbox="allow-same-origin" `
    + `style="border:none;width:100%;height:100%;"></iframe>`;
}

/** Load the element's overlay asset (owner-tagged) for the export. The
 *  app fetches the owned asset id via db_get_owned_asset_id; the export
 *  callback in fileOps resolves overlay bytes the same way and passes
 *  them through getAssetBytes by the overlay's own asset id when known.
 *  Here we look it up via the same convention useOverlay uses; if the
 *  caller can't supply it, we fall back to empty (no recorded session). */
async function loadOverlay(
  element: NotebookElement,
  getAssetBytes: AssetBytes,
): Promise<Overlay> {
  const key = element.syncId ?? element.id;
  try {
    // useOverlay persists overlays under a deterministic asset id
    // `overlay-<key>` (see useOverlay.flushNow / writeOverlayFor). Try
    // that id directly via getAssetBytes; a missing asset throws → empty.
    const bytes = await getAssetBytes(`overlay-${key}`);
    return parseOverlay(toUint8(bytes));
  } catch {
    return emptyOverlay();
  }
}
