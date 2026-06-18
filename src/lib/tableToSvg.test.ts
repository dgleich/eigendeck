import { describe, it, expect } from 'vitest';
import { htmlTableToSvg, looksLikeTableHtml } from './tableToSvg';

// Real clipboard text/html from Google Sheets (a 3x3 range copy).
const SHEETS_HTML = `<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">test</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;"></td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;"></td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">1</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">2</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">3</td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">4</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">5</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">6</td></tr></tbody></table></google-sheets-html-origin>`;

describe('looksLikeTableHtml', () => {
  it('detects a table, ignores plain html', () => {
    expect(looksLikeTableHtml(SHEETS_HTML)).toBe(true);
    expect(looksLikeTableHtml('<div>hi</div>')).toBe(false);
    expect(looksLikeTableHtml('')).toBe(false);
    expect(looksLikeTableHtml(null)).toBe(false);
  });
});

describe('htmlTableToSvg — Google Sheets', () => {
  const r = htmlTableToSvg(SHEETS_HTML)!;

  it('parses the grid shape from <col>/<tr>', () => {
    expect(r).not.toBeNull();
    expect(r.cols).toBe(3);
    expect(r.rows).toBe(3);
    expect(r.width).toBe(300); // 3 * col width 100
    expect(r.height).toBe(63); // 3 * row height 21
  });

  it('emits a valid self-contained SVG (no foreignObject)', () => {
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).not.toContain('foreignObject');
    expect(r.svg).toContain(`viewBox="0 0 300 63"`);
  });

  it('draws a rect for every cell (3x3 = 9)', () => {
    expect((r.svg.match(/<rect /g) || []).length).toBe(9 + 1); // +1 white background
  });

  it('renders every non-empty cell value', () => {
    for (const v of ['test', '1', '2', '3', '4', '5', '6']) {
      expect(r.svg).toContain(`>${v}</text>`);
    }
  });

  it('right-aligns numeric cells (text-anchor=end), left-aligns text', () => {
    expect(r.svg).toMatch(/text-anchor="end"[^>]*>1<\/text>/);
    expect(r.svg).toMatch(/text-anchor="start"[^>]*>test<\/text>/);
  });

  it('returns null when there is no table', () => {
    expect(htmlTableToSvg('<div>no table here</div>')).toBeNull();
  });
});
