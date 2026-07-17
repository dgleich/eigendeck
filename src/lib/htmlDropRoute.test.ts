import { describe, it, expect } from 'vitest';
import { classifyDroppedHtml } from './htmlDropRoute';

const DEMO_MARKER = '<!doctype html><!--eigendeck-demo-v1-->';

describe('classifyDroppedHtml', () => {
  it('routes a marked single-frame demo to "demo"', () => {
    const html = `${DEMO_MARKER}<html><body><canvas></canvas></body></html>`;
    expect(classifyDroppedHtml(html)).toEqual({ kind: 'demo' });
  });

  it('routes a marked multi-piece demo to "demo-pieces" with the piece names', () => {
    const html = `${DEMO_MARKER}
      <script>
        const p = new BroadcastChannel('x');
        if (piece === 'force-graph') draw();
        if (piece === 'matrix') other();
      </script>`;
    expect(classifyDroppedHtml(html)).toEqual({
      kind: 'demo-pieces',
      pieces: ['force-graph', 'matrix'],
    });
  });

  it('treats a marked demo with piece checks but no BroadcastChannel as a single demo', () => {
    const html = `${DEMO_MARKER}<script>if (piece === 'a') go();</script>`;
    expect(classifyDroppedHtml(html)).toEqual({ kind: 'demo' });
  });

  it('a demo marker wins even when the body has scripts/handlers the snippet gate would reject', () => {
    // Demos legitimately contain <script>; the marker must short-circuit BEFORE
    // validateHtmlSnippet so a real demo is never mis-rejected.
    const html = `${DEMO_MARKER}<div onclick="x()"></div><script>run()</script>`;
    expect(classifyDroppedHtml(html).kind).toBe('demo');
  });

  it('falls back to an html element for a plain, usable snippet', () => {
    const route = classifyDroppedHtml('<div style="color:red">hi ✦</div>');
    expect(route).toEqual({ kind: 'html-element', html: '<div style="color:red">hi ✦</div>', interactive: false });
  });

  it('marks an html-element interactive when the snippet metadata says so', () => {
    const html = '<!-- eigendeck-html-element interactive --><input type="range">';
    const route = classifyDroppedHtml(html);
    expect(route.kind).toBe('html-element');
    if (route.kind === 'html-element') expect(route.interactive).toBe(true);
  });

  it('rejects a non-demo snippet that references remote resources', () => {
    const route = classifyDroppedHtml('<img src="https://example.com/x.png">');
    expect(route.kind).toBe('reject');
    if (route.kind === 'reject') {
      expect(route.problems.length).toBeGreaterThan(0);
      expect(route.problems.join(' ')).toMatch(/remote/i);
    }
  });

  it('rejects a non-demo snippet that contains a script', () => {
    const route = classifyDroppedHtml('<div></div><script>alert(1)</script>');
    expect(route.kind).toBe('reject');
    if (route.kind === 'reject') expect(route.problems.join(' ')).toMatch(/script/i);
  });

  it('rejects an empty / non-HTML file', () => {
    expect(classifyDroppedHtml('   ').kind).toBe('reject');
    expect(classifyDroppedHtml('just some plain text, no tags').kind).toBe('reject');
  });
});
