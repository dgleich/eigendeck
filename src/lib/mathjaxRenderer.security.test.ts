// Security regression: script-capable demo/notebook iframes share the parent
// window's `message` event bus with the hidden MathJax renderer. A predictable
// request id must never be enough to impersonate that renderer.
//
// This proof is deliberately inert: the forged response contains only a
// data-proof SVG marker. It tests message provenance, not script execution.
import { describe, expect, it, vi } from 'vitest';
import { renderMath } from './mathjaxRenderer';

describe('mathjaxRenderer message provenance', () => {
  it('ignores a correctly-shaped reply from a non-renderer window', async () => {
    const rendering = renderMath('x-security-probe', 'ptsans');
    let settled = false;
    void rendering.finally(() => { settled = true; });

    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-mathjax-bundle="ptsans"]');
    expect(iframe?.contentWindow).toBeTruthy();
    const rendererWindow = iframe!.contentWindow!;
    const post = vi.spyOn(rendererWindow, 'postMessage');

    // Let the real renderer window complete its ready handshake, then capture
    // the request id that the parent sends it.
    window.dispatchEvent(new MessageEvent('message', {
      source: rendererWindow,
      data: { type: 'ready', bundle: 'ptsans' },
    }));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const request = post.mock.calls.find(([data]) => (data as { type?: string }).type === 'render')?.[0] as { id?: string } | undefined;
    expect(request?.id).toMatch(/^r\d+$/);

    // Same type and predictable id, but from the parent window rather than the
    // owning MathJax iframe: this models an unrelated sandboxed child sender.
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: 'rendered', id: request!.id, svg: '<svg data-proof="forged"></svg>' },
    }));
    await Promise.resolve();
    expect(settled).toBe(false);

    // The identical harmless protocol response from the owning iframe is valid.
    window.dispatchEvent(new MessageEvent('message', {
      source: rendererWindow,
      data: { type: 'rendered', id: request!.id, svg: '<svg data-proof="trusted"></svg>' },
    }));
    await expect(rendering).resolves.toMatchObject({ svg: '<svg data-proof="trusted"></svg>' });
  });
});
