// Convert a pasted HTML <table> (e.g. from Google Sheets, which puts ONLY
// text/html + text/plain on the clipboard — no image) into a self-contained
// SVG so it can be inserted through the same path as an Excel/Pages SVG paste.
//
// We emit native SVG primitives (<rect> per cell + <text>), NOT a
// <foreignObject> wrapping the HTML: foreignObject doesn't rasterize reliably
// in WebKit (tainted canvas), which would break sidebar thumbnails and PDF
// export. Native SVG rasterizes cleanly and scales crisply.
//
// Scope: a flat grid of cells. colspan/rowspan are treated as 1x1 for now
// (Sheets emits simple grids for a range copy); merged cells can come later.

export interface TableSvg {
  svg: string;
  /** Intrinsic (native) px dimensions of the table, for aspect ratio. */
  width: number;
  height: number;
  rows: number;
  cols: number;
}

interface Opts {
  /** Default column width (px) when <col width> is absent. */
  defaultColWidth?: number;
  /** Default row height (px) when the row has no explicit height. */
  defaultRowHeight?: number;
  /** Cell text padding (px). */
  pad?: number;
  /** Font size (px). Sheets default is 10pt ≈ 13px. */
  fontSize?: number;
  /** Font family baked into the SVG text. */
  fontFamily?: string;
  /** Grid line color. */
  borderColor?: string;
}

const DEFAULTS: Required<Opts> = {
  defaultColWidth: 100,
  defaultRowHeight: 21,
  pad: 4,
  fontSize: 13,
  fontFamily: "'PT Sans', Arial, sans-serif",
  borderColor: '#cccccc',
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

function alignFromStyle(style: string | null): 'left' | 'right' | 'center' {
  if (!style) return 'left';
  const m = /text-align\s*:\s*(left|right|center)/i.exec(style);
  return (m ? m[1] : 'left') as 'left' | 'right' | 'center';
}

/**
 * Parse an HTML string and render its first <table> to SVG. Returns null if
 * there's no usable table. Requires a DOM (browser/Tauri webview or jsdom).
 */
export function htmlTableToSvg(html: string, opts: Opts = {}): TableSvg | null {
  const o = { ...DEFAULTS, ...opts };
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;

  const rowEls = Array.from(table.querySelectorAll('tr'));
  if (rowEls.length === 0) return null;

  // Column widths from <colgroup><col width>, else default. Grid is sized to
  // the widest row's cell count.
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
  let y = 0;
  for (const tr of rowEls) {
    const rowH = pxFromStyle(tr.getAttribute('style'), 'height') || o.defaultRowHeight;
    const cells = Array.from(tr.querySelectorAll('td,th'));
    for (let c = 0; c < cellCount; c++) {
      const x = colX[c];
      const w = colWidths[c];
      rects.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="none" ` +
        `stroke="${o.borderColor}" stroke-width="1" shape-rendering="crispEdges"/>`,
      );
      const td = cells[c];
      const text = td ? (td.textContent || '').trim() : '';
      if (text) {
        const isHeader = td!.tagName.toLowerCase() === 'th';
        const align = alignFromStyle(td!.getAttribute('style'));
        let tx = x + o.pad;
        let anchor = 'start';
        if (align === 'right') { tx = x + w - o.pad; anchor = 'end'; }
        else if (align === 'center') { tx = x + w / 2; anchor = 'middle'; }
        // vertical-align bottom (Sheets default): baseline near the cell bottom.
        const ty = y + rowH - o.pad;
        texts.push(
          `<text x="${tx}" y="${ty}" font-family="${o.fontFamily}" font-size="${o.fontSize}" ` +
          `text-anchor="${anchor}"${isHeader ? ' font-weight="bold"' : ''} fill="#1a1a1a">${esc(text)}</text>`,
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

  return { svg, width: totalW, height: totalH, rows: rowEls.length, cols: cellCount };
}

/** Quick check: does this clipboard HTML contain a table worth converting? */
export function looksLikeTableHtml(html: string | null | undefined): boolean {
  return !!html && /<table[\s>]/i.test(html);
}
