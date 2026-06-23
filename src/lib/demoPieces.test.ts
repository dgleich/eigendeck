import { describe, it, expect } from 'vitest';
import { extractDemoPieceNames } from './demoPieces';

describe('extractDemoPieceNames (#44)', () => {
  it('matches hyphenated piece names (the bug)', () => {
    const html = `if (piece === 'force-graph') {} else if (piece === 'bar-chart-2') {}`;
    expect(extractDemoPieceNames(html)).toEqual(['force-graph', 'bar-chart-2']);
  });

  it('handles plain, underscore, and digit names', () => {
    expect(extractDemoPieceNames(`piece === 'graph'; piece === 'panel_1'; piece === 'v2'`))
      .toEqual(['graph', 'panel_1', 'v2']);
  });

  it('accepts == and === and either quote style', () => {
    const html = `piece == "single-quote-ish"; piece === 'force-graph'`;
    expect(extractDemoPieceNames(html)).toEqual(['single-quote-ish', 'force-graph']);
  });

  it('dedupes repeats, preserving first-seen order', () => {
    expect(extractDemoPieceNames(`piece==='a'; piece==='b'; piece==='a'`)).toEqual(['a', 'b']);
  });

  it('returns [] when there are no piece checks', () => {
    expect(extractDemoPieceNames('<html><body>no pieces here</body></html>')).toEqual([]);
  });
});
