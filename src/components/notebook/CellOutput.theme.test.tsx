import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CellOutput } from './CellOutput';
import type { CellOutput as CellOutputT } from '../../lib/notebookFormat';
import './notebook.css';

// A dark/black slide sets --nb-fg to a light color on the frame; cell OUTPUT text must
// FOLLOW the theme. stdout was hardcoded #111827 (near-black) → invisible on a black
// slide. (jsdom applies CSS but does NOT resolve var(), so a theme-derived color reads
// back as the literal `var(--nb-fg, …)` — which is exactly what we assert for; the
// stderr/error dark override uses explicit colors so its resolved value is checkable.)
function inDarkFrame(output: CellOutputT) {
  return render(
    <div className="el-notebook" style={{ ['--nb-fg' as string]: 'rgb(240, 240, 240)' }}>
      <div className="nb-frame nb-theme-dark">
        <CellOutput output={output} />
      </div>
    </div>,
  );
}
const color = (el: Element | null) => getComputedStyle(el as HTMLElement).color;

describe('CellOutput is theme-aware on dark slides', () => {
  it('stdout derives from the theme foreground (--nb-fg), not a hardcoded near-black', () => {
    const { container } = inDarkFrame({ kind: 'stream', name: 'stdout', text: 'hello' } as CellOutputT);
    const c = color(container.querySelector('.nb-stdout'));
    expect(c).not.toBe('rgb(17, 24, 39)');   // #111827 — the invisible-on-black bug
    expect(c).toMatch(/^var\(--nb-fg/);       // reads the theme foreground var
  });

  it('plain (execute_result text) derives from --nb-fg', () => {
    const { container } = inDarkFrame({ kind: 'execute_result', data: { 'text/plain': '42' } } as unknown as CellOutputT);
    expect(color(container.querySelector('.nb-plain'))).toMatch(/^var\(--nb-fg/);
  });

  it('stderr uses the readable dark-theme palette (not the light-pink box)', () => {
    const { container } = inDarkFrame({ kind: 'stream', name: 'stderr', text: 'oops' } as CellOutputT);
    // dark override: light-red text (#fca5a5) — not the light-theme dark-red #991b1b.
    expect(color(container.querySelector('.nb-stderr'))).toBe('rgb(252, 165, 165)');
  });

  it('error traceback uses the readable dark-theme palette', () => {
    const { container } = inDarkFrame({ kind: 'error', ename: 'E', evalue: 'v', traceback: ['boom'] } as unknown as CellOutputT);
    expect(color(container.querySelector('.nb-error'))).toBe('rgb(252, 165, 165)');
  });
});
