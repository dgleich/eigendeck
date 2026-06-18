// Convert a pasted HTML <table> (e.g. from Google Sheets, which puts ONLY
// text/html + text/plain on the clipboard — no image) into a self-contained
// SVG so it can be inserted through the same path as an Excel/Pages SVG paste.
//
// We emit native SVG primitives (<rect>/<line> + <text>), NOT a <foreignObject>
// wrapping the HTML: foreignObject doesn't rasterize reliably in WebKit
// (tainted canvas), which would break sidebar thumbnails and PDF export.
//
// Styling picked up per cell from inline `style`: font-weight (bold),
// font-style (italic), color, background-color, vertical-align, font-size,
// text-align, font-family, and PER-SIDE borders.
//
// BORDERS: Sheets encodes the real cell borders per side (4-value
// `border-color: top right bottom left`), using rgb(0,0,0)/etc for borders the
// user actually set and rgb(204,204,204) (#ccc) for the default UI gridline. We
// render only the real sides and SKIP the default grey grid — so a range with
// borders shows them (per side), and an unbordered range pastes clean.
//
// FONTS: an <img>-rendered SVG can only use SYSTEM fonts or fonts embedded in
// the SVG. Each cell's font-family cascades: source (Sheets) font → the deck
// body font (caller embeds it via @font-face) → generic. usesBold/usesItalic
// tell the caller which faces to embed.
//
// Scope: a flat grid of cells. colspan/rowspan are treated as 1x1 for now.

export interface TableSvg {
  svg: string;
  width: number;
  height: number;
  rows: number;
  cols: number;
  usesBold: boolean;
  usesItalic: boolean;
}

interface Opts {
  defaultColWidth?: number;
  defaultRowHeight?: number;
  pad?: number;
  fontSize?: number;
  fallbackFamily?: string;
  textColor?: string;
}

const DEFAULTS: Required<Opts> = {
  defaultColWidth: 100,
  defaultRowHeight: 21,
  pad: 4,
  fontSize: 13,
  fallbackFamily: 'PT Sans',
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

function toPx(n: string, unit: string): number {
  return unit === 'pt' ? parseFloat(n) * (96 / 72) : parseFloat(n);
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

function fontStack(src: string | undefined, fallback: string): string {
  const parts: string[] = [];
  const s = (src || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (s && s.toLowerCase() !== fallback.toLowerCase()) parts.push(quoteFamily(s));
  parts.push(quoteFamily(fallback));
  parts.push('sans-serif');
  return parts.join(', ');
}

// ---- per-side border parsing --------------------------------------------

/** Sheets' default UI gridline — not a real border, so we don't draw it. */
function isDefaultGridColor(c: string | undefined): boolean {
  if (!c) return false;
  const v = c.toLowerCase().replace(/\s+/g, '');
  return v === 'rgb(204,204,204)' || v === '#cccccc' || v === '#ccc';
}

function splitDecls(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Expand a CSS 1–4 value shorthand to [top, right, bottom, left]. */
function expand4<T>(a: T[]): (T | undefined)[] {
  if (a.length === 1) return [a[0], a[0], a[0], a[0]];
  if (a.length === 2) return [a[0], a[1], a[0], a[1]];
  if (a.length === 3) return [a[0], a[1], a[2], a[1]];
  if (a.length >= 4) return [a[0], a[1], a[2], a[3]];
  return [undefined, undefined, undefined, undefined];
}

function colorTokens(v: string): string[] {
  return v.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+/g) || [];
}

function parseBorderShorthand(v: string): { width?: number; style?: string; color?: string } {
  const w = /([0-9.]+)(px|pt)/i.exec(v);
  const s = /\b(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)\b/i.exec(v);
  const c = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/i.exec(v);
  return { width: w ? toPx(w[1], w[2]) : undefined, style: s ? s[1].toLowerCase() : undefined, color: c ? c[0] : undefined };
}

interface SideBorder { width: number; color: string; }

/** Resolve [top,right,bottom,left] real borders for a cell; null = no border. */
function parseCellBorders(styleStr: string): (SideBorder | null)[] {
  const d = splitDecls(styleStr);
  const W: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  const S: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  const C: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  const set = (i: number, w?: number, s?: string, c?: string) => {
    if (w !== undefined) W[i] = w; if (s) S[i] = s; if (c) C[i] = c;
  };

  if (d['border']) { const b = parseBorderShorthand(d['border']); for (let i = 0; i < 4; i++) set(i, b.width, b.style, b.color); }
  if (d['border-width']) { const a = expand4(d['border-width'].trim().split(/\s+/).map((t) => { const m = /([0-9.]+)(px|pt)/i.exec(t); return m ? toPx(m[1], m[2]) : undefined; })); for (let i = 0; i < 4; i++) if (a[i] !== undefined) W[i] = a[i]; }
  if (d['border-style']) { const a = expand4(d['border-style'].trim().split(/\s+/)); for (let i = 0; i < 4; i++) if (a[i]) S[i] = a[i]; }
  if (d['border-color']) { const a = expand4(colorTokens(d['border-color'])); for (let i = 0; i < 4; i++) if (a[i]) C[i] = a[i]; }

  const sides = ['top', 'right', 'bottom', 'left'];
  sides.forEach((side, i) => {
    if (d[`border-${side}`]) { const b = parseBorderShorthand(d[`border-${side}`]); set(i, b.width, b.style, b.color); }
    if (d[`border-${side}-width`]) { const m = /([0-9.]+)(px|pt)/i.exec(d[`border-${side}-width`]); if (m) W[i] = toPx(m[1], m[2]); }
    if (d[`border-${side}-style`]) S[i] = d[`border-${side}-style`].trim().toLowerCase();
    if (d[`border-${side}-color`]) C[i] = d[`border-${side}-color`].trim();
  });

  return [0, 1, 2, 3].map((i) => {
    const style = S[i] || (C[i] || W[i] !== undefined ? 'solid' : undefined);
    const width = W[i] ?? 1;
    const color = C[i];
    if (!style || style === 'none' || style === 'hidden' || width <= 0) return null;
    if (!color || isDefaultGridColor(color)) return null; // skip the default grey grid
    return { width, color };
  });
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

  const fills: string[] = [];
  const lines: string[] = [];
  const texts: string[] = [];
  let usesBold = false;
  let usesItalic = false;
  let maxBorder = 1;
  let y = 0;
  for (const tr of rowEls) {
    const rowH = pxFromStyle(tr.getAttribute('style'), 'height') || o.defaultRowHeight;
    const cells = Array.from(tr.querySelectorAll('td,th')) as HTMLTableCellElement[];
    for (let c = 0; c < cellCount; c++) {
      const x = colX[c];
      const w = colWidths[c];
      const td = cells[c];
      const styleStr = td?.getAttribute('style') || '';
      const st = td?.style;

      const bg = st ? visibleBg(st.backgroundColor) : null;
      if (bg) fills.push(`<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="${esc(bg)}"/>`);

      // Per-side borders (real ones only; the grey default grid is skipped).
      if (styleStr) {
        const [bt, br, bb, bl] = parseCellBorders(styleStr);
        const edge = (b: SideBorder | null, x1: number, y1: number, x2: number, y2: number) => {
          if (!b) return;
          maxBorder = Math.max(maxBorder, b.width);
          lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${esc(b.color)}" stroke-width="${b.width}" shape-rendering="crispEdges"/>`);
        };
        edge(bt, x, y, x + w, y);
        edge(bb, x, y + rowH, x + w, y + rowH);
        edge(bl, x, y, x, y + rowH);
        edge(br, x + w, y, x + w, y + rowH);
      }

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

  // Margin so outer edge lines (a 1px stroke straddles the boundary) aren't
  // clipped. White page so cells read over any slide background.
  const m = Math.ceil(maxBorder);
  const W2 = totalW + 2 * m, H2 = totalH + 2 * m;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}" ` +
    `viewBox="${-m} ${-m} ${W2} ${H2}">` +
    `<rect x="${-m}" y="${-m}" width="${W2}" height="${H2}" fill="#ffffff"/>` +
    fills.join('') + lines.join('') + texts.join('') +
    `</svg>`;

  return { svg, width: W2, height: H2, rows: rowEls.length, cols: cellCount, usesBold, usesItalic };
}

/** Quick check: does this clipboard HTML contain a table worth converting? */
export function looksLikeTableHtml(html: string | null | undefined): boolean {
  return !!html && /<table[\s>]/i.test(html);
}
