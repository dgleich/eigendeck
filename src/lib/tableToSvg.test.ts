import { describe, it, expect } from 'vitest';
import { htmlTableToSvg, looksLikeTableHtml } from './tableToSvg';

// Real Google Sheets clipboard text/html — a 3x3 range with NO user borders
// (every side is the default grey gridline rgb(204,204,204)).
const NONE = `<table style="table-layout: fixed; font-size: 10pt; font-family: Arial; border-collapse: collapse;"><colgroup><col width="100"><col width="100"><col width="100"></colgroup><tbody><tr style="height: 21px;"><td style="border: 1px solid rgb(204, 204, 204); padding: 2px 3px; vertical-align: bottom; font-family: &quot;Roboto Mono&quot;; font-weight: normal;">test</td><td style="border: 1px solid rgb(204, 204, 204); font-family: &quot;Roboto Mono&quot;;">column 1</td><td style="border: 1px solid rgb(204, 204, 204);">column 2</td></tr><tr style="height: 21px;"><td style="border: 1px solid rgb(204, 204, 204); text-align: right;">1</td><td style="border: 1px solid rgb(204, 204, 204); font-weight: bold; text-align: right;">2</td><td style="border: 1px solid rgb(204, 204, 204); text-align: right;">3</td></tr><tr style="height: 21px;"><td style="border: 1px solid rgb(204, 204, 204); background-color: rgb(255, 242, 204); text-align: right;">4</td><td style="border: 1px solid rgb(204, 204, 204); background-color: rgb(255, 242, 204); color: rgb(133, 32, 12); text-align: right;">5</td><td style="border: 1px solid rgb(204, 204, 204); background-color: rgb(255, 242, 204); text-align: right;">6</td></tr></tbody></table>`;

// Same range WITH a black box border: real sides are rgb(0,0,0), inner/default
// sides are rgb(204,204,204). Encoded via the 4-value border-color shorthand
// (top right bottom left) and the `border` shorthand on the first cell.
const BORDERS = `<table style="font-family: Arial; border-collapse: collapse;"><colgroup><col width="100"><col width="100"><col width="100"></colgroup><tbody><tr style="height: 21px;"><td style="border: 1px solid rgb(0, 0, 0); font-family: &quot;Roboto Mono&quot;;">test</td><td style="border-width: 1px; border-style: solid; border-color: rgb(0, 0, 0) rgb(0, 0, 0) rgb(0, 0, 0) rgb(204, 204, 204);">column 1</td><td style="border-width: 1px; border-style: solid; border-color: rgb(0, 0, 0) rgb(0, 0, 0) rgb(0, 0, 0) rgb(204, 204, 204);">column 2</td></tr><tr style="height: 21px;"><td style="border-width: 1px; border-style: solid; border-color: rgb(204, 204, 204) rgb(0, 0, 0) rgb(0, 0, 0); text-align: right;">1</td><td style="border-width: 1px; border-style: solid; border-color: rgb(204, 204, 204) rgb(0, 0, 0) rgb(0, 0, 0) rgb(204, 204, 204); font-weight: bold; text-align: right;">2</td><td style="border-width: 1px; border-style: solid; border-color: rgb(204, 204, 204) rgb(0, 0, 0) rgb(0, 0, 0) rgb(204, 204, 204); text-align: right;">3</td></tr></tbody></table>`;

describe('looksLikeTableHtml', () => {
  it('detects a table, ignores plain html', () => {
    expect(looksLikeTableHtml(NONE)).toBe(true);
    expect(looksLikeTableHtml('<div>hi</div>')).toBe(false);
    expect(looksLikeTableHtml(null)).toBe(false);
  });
});

describe('htmlTableToSvg — structure & values', () => {
  const r = htmlTableToSvg(NONE)!;
  it('parses the grid', () => {
    expect(r.cols).toBe(3);
    expect(r.rows).toBe(3);
  });
  it('emits a self-contained SVG (no foreignObject)', () => {
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg).not.toContain('foreignObject');
  });
  it('renders every non-empty cell value', () => {
    for (const v of ['test', 'column 1', 'column 2', '1', '2', '3', '4', '5', '6']) {
      expect(r.svg).toContain(`>${v}</text>`);
    }
  });
  it('fills colored cells (yellow last row)', () => {
    expect((r.svg.match(/fill="rgb\(255, 242, 204\)"/g) || []).length).toBe(3);
  });
  it('applies per-cell text color', () => {
    expect(r.svg).toMatch(/fill="rgb\(133, 32, 12\)"[^>]*>5<\/text>/);
  });
  it('reports used faces (bold cell present, no italic)', () => {
    expect(r.usesBold).toBe(true);
    expect(r.usesItalic).toBe(false);
  });
});

describe('htmlTableToSvg — borders (the #78 fix)', () => {
  it('range with NO user borders → no border lines at all (clean)', () => {
    const r = htmlTableToSvg(NONE)!;
    expect(r.svg).not.toContain('<line');
  });

  it('range WITH borders → draws the real (black) sides, skips the grey grid', () => {
    const r = htmlTableToSvg(BORDERS)!;
    expect(r.svg).toContain('<line'); // real borders drawn
    expect(r.svg).toMatch(/<line[^>]*stroke="rgb\(0, 0, 0\)"/); // black sides
    expect(r.svg).not.toMatch(/<line[^>]*stroke="rgb\(204, 204, 204\)"/); // grey grid skipped
  });

  it('honours per-side borders (first cell = full black box → 4 lines)', () => {
    // The "test" cell uses `border: 1px solid rgb(0,0,0)` on all four sides.
    const r = htmlTableToSvg(`<table><tbody><tr style="height:21px;"><td style="border:1px solid rgb(0,0,0);">x</td></tr></tbody></table>`)!;
    expect((r.svg.match(/<line/g) || []).length).toBe(4);
  });

  it('a single bottom border renders one line, nothing else', () => {
    const r = htmlTableToSvg(`<table><tbody><tr style="height:21px;"><td style="border-bottom:2px solid rgb(0,0,0);">x</td></tr></tbody></table>`)!;
    const lines = r.svg.match(/<line[^>]*>/g) || [];
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('stroke-width="2"');
  });
});

describe('htmlTableToSvg — font cascade', () => {
  it('source font (Roboto Mono) → deck fallback → generic', () => {
    const r = htmlTableToSvg(NONE)!;
    expect(r.svg).toContain(`font-family="'Roboto Mono', 'PT Sans', sans-serif"`);
  });
  it('honours a custom deck fallback family; no source → fallback only', () => {
    const r = htmlTableToSvg(`<table><tbody><tr><td>x</td></tr></tbody></table>`, { fallbackFamily: 'Lato' })!;
    expect(r.svg).toContain(`font-family="Lato, sans-serif"`);
  });
  it('returns null when there is no table', () => {
    expect(htmlTableToSvg('<div>no table</div>')).toBeNull();
  });
});
