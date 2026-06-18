// Convert a pasted HTML <table> (e.g. from Google Sheets, which puts ONLY
// text/html + text/plain on the clipboard — no image) into a self-contained
// SVG so it can be inserted through the same path as an Excel/Pages SVG paste.
//
// We emit native SVG primitives (<rect> per cell + <text>), NOT a
// <foreignObject> wrapping the HTML: foreignObject doesn't rasterize reliably
// in WebKit (tainted canvas), which would break sidebar thumbnails and PDF
// export. Native SVG rasterizes cleanly and scales crisply.
//
// Styling picked up per cell from inline `style`: font-weight (bold),
// font-style (italic), color, background-color, vertical-align, font-size,
// text-align, and font-family.
//
// FONTS: an <img>-rendered SVG can only use SYSTEM fonts or fonts embedded in
// the SVG. So each cell's font-family is a cascade: the source (Sheets) font
// first (used when it's a real system font like Arial / Courier New), then the
// deck's body font (which the caller embeds via @font-face — guaranteed
// present, matches the slides), then a generic. `usesBold`/`usesItalic` tell
// the caller which faces to embed.
//
// Scope: a flat grid of cells. colspan/rowspan are treated as 1x1 for now.

export interface TableSvg {
  svg: string;
  /** Intrinsic (native) px dimensions of the table, for aspect ratio. */
  width: number;
  height: number;
  rows: number;
  cols: number;
  /** Whether any cell is bold / italic — caller embeds only the needed faces. */
  usesBold: boolean;
  usesItalic: boolean;
}

interface Opts {
  defaultColWidth?: number;
  defaultRowHeight?: number;
  pad?: number;
  fontSize?: number;
  /** Deck body-font family — the fallback used when the source font isn't
   *  available. The caller embeds this family's @font-face into the SVG. */
  fallbackFamily?: string;
  borderColor?: string;
  textColor?: string;
}

const DEFAULTS: Required<Opts> = {
  defaultColWidth: 100,
  defaultRowHeight: 21,
  pad: 4,
  fontSize: 13,
  fallbackFamily: 'PT Sans',
  borderColor: '#cccccc',
  textColor: '#1a1a1a',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pxFromStyle(style: string | null, prop: string): number | null {
  if (!style) return null;
  const m = new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`, 'i').exec(style);
  return m ? parseFloat(m[1]) : null;
}

function fontSizePx(v: string | undefined, emBase: number): number | null {
  if (!v) return null;
  let m = /([0-9.]+)pt/i.exec(v); if (m) return parseFloat(m[1]) * (96 / 72);
  m = /([0-9.]+)px/i.exec(v); if (m) return parseFloat(m[1]);
  m = /([0-9.]+)em/i.exec(v); if (m) return parseFloat(m[1]) * emBase;
  return null;
}

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  if (weight === 'bold' || weight === 'bolder') return true;
  const n = parseInt(weight, 10);
  return Number.isFinite(n) && n >= 600;
}

function visibleBg(bg: string | undefined): string | null {
  if (!bg) return null;
  const v = bg.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return null;
  if (v === '#fff' || v === '#ffffff' || v === 'white' || v === 'rgb(255, 255, 255)') return null;
  return bg;
}

function quoteFamily(f: string): string {
  return /^[a-zA-Z][\w-]*$/.test(f) ? f : `'${f.replace(/'/g, '')}'`;
}

/** source font (if any) → deck fallback → generic. */
function fontStack(src: string | undefined, fallback: string): string {
  const parts: string[] = [];
  const s = (src || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (s && s.toLowerCase() !== fallback.toLowerCase()) parts.push(quoteFamily(s));
  parts.push(quoteFamily(fallback));
  parts.push('sans-serif');
  return parts.join(', ');
}

/**
 * Parse an HTML string and render its first <table> to SVG. Returns null if
 * there's no usable table. Requires a DOM (browser/Tauri webview or jsdom).
 */
export function htmlTableToSvg(html: string, opts: Opts = {}): TableSvg | null {
  const o = { ...DEFAULTS, ...opts };
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table') as HTMLTableElement | null;
  if (!table) return null;

  const rowEls = Array.from(table.querySelectorAll('tr'));
  if (rowEls.length === 0) return null;

  const tableSrcFamily = table.style.fontFamily || '';
  const tableFontSize = fontSizePx(table.style.fontSize, o.fontSize) ?? o.fontSize;

  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const cellCount = Math.max(...rowEls.map((tr) => tr.querySelectorAll('td,th').length));
  if (cellCount === 0) return null;
  const colWidths: number[] = [];
  for (let c = 0; c < cellCount; c++) {
    const col = colEls[c];
    const w = col ? (parseFloat(col.getAttribute('width') || '') || pxFromStyle(col.getAttribute('style'), 'width')) : null;
    colWidths.push(w && w > 0 ? w : o.defaultColWidth);
  }
  const colX: number[] = [0];
  for (let c = 0; c < cellCount; c++) colX.push(colX[c] + colWidths[c]);
  const totalW = colX[cellCount];

  const rects: string[] = [];
  const texts: string[] = [];
  let usesBold = false;
  let usesItalic = false;
  let y = 0;
  for (const tr of rowEls) {
    const rowH = pxFromStyle(tr.getAttribute('style'), 'height') || o.defaultRowHeight;
    const cells = Array.from(tr.querySelectorAll('td,th')) as HTMLTableCellElement[];
    for (let c = 0; c < cellCount; c++) {
      const x = colX[c];
      const w = colWidths[c];
      const td = cells[c];
      const st = td?.style;
      const bg = st ? visibleBg(st.backgroundColor) : null;
      rects.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="${bg || 'none'}" ` +
        `stroke="${o.borderColor}" stroke-width="1" shape-rendering="crispEdges"/>`,
      );
      const text = td ? (td.textContent || '').trim() : '';
      if (text && st) {
        const isTh = td.tagName.toLowerCase() === 'th';
        const align = (st.textAlign || (isTh ? 'center' : 'left')) as string;
        const valign = st.verticalAlign || 'bottom';
        const size = fontSizePx(st.fontSize, tableFontSize) ?? tableFontSize;
        const bold = isBold(st.fontWeight) || isTh;
        const italic = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
        const color = st.color || o.textColor;
        if (bold) usesBold = true;
        if (italic) usesItalic = true;
        const family = fontStack(st.fontFamily || tableSrcFamily, o.fallbackFamily);

        let tx = x + o.pad, anchor = 'start';
        if (align === 'right' || align === 'end') { tx = x + w - o.pad; anchor = 'end'; }
        else if (align === 'center') { tx = x + w / 2; anchor = 'middle'; }

        let ty: number;
        if (valign === 'top') ty = y + o.pad + size * 0.82;
        else if (valign === 'middle') ty = y + rowH / 2 + size * 0.32;
        else ty = y + rowH - o.pad;

        texts.push(
          `<text x="${tx}" y="${ty}" font-family="${esc(family)}" font-size="${Math.round(size)}" ` +
          `text-anchor="${anchor}"${bold ? ' font-weight="bold"' : ''}` +
          `${italic ? ' font-style="italic"' : ''} fill="${esc(color)}">${esc(text)}</text>`,
        );
      }
    }
    y += rowH;
  }
  const totalH = y;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" ` +
    `viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
    rects.join('') + texts.join('') +
    `</svg>`;

  return { svg, width: totalW, height: totalH, rows: rowEls.length, cols: cellCount, usesBold, usesItalic };
}

/** Quick check: does this clipboard HTML contain a table worth converting? */
export function looksLikeTableHtml(html: string | null | undefined): boolean {
  return !!html && /<table[\s>]/i.test(html);
}
