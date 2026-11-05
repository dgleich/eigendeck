import { describe, it, expect } from 'vitest';
import { injectDemoBridge } from './demoBridge';

const DOC = '<html><head></head><body><div>demo</div></body></html>';

describe('injectDemoBridge network policy', () => {
  it("net:'block' → default-src 'none', only inline scripts/styles, no remote anything", () => {
    const out = injectDemoBridge(DOC, '', 'ch', { net: 'block' });
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("form-action 'none'");
    // inline scripts/styles run (demo renders) but NO remote host is a source
    expect(out).toContain("script-src 'unsafe-inline'");
    expect(out).toContain("style-src 'unsafe-inline'");
    expect(out).toMatch(/script-src 'unsafe-inline' 'wasm-unsafe-eval';/);   // wasm allowed; no CDN host after
    expect(out).toContain('delete window.RTCPeerConnection');
    // CSP must precede the demo (first in <head> to be honored)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<div>demo</div>'));
  });

  it('net:{hosts} → declared hosts scope connect AND script/style/img/media/font', () => {
    const out = injectDemoBridge(DOC, '', 'ch', { net: { hosts: ['api.stock.example', 'http://localhost:8888'] } });
    expect(out).toContain('connect-src https://api.stock.example wss://api.stock.example http://localhost:8888');
    expect(out).not.toContain("connect-src 'none'");
    // a declared CDN can serve the demo's scripts + styles + assets
    expect(out).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' https://api.stock.example wss://api.stock.example http://localhost:8888");
    expect(out).toContain("style-src 'unsafe-inline' https://api.stock.example");
    expect(out).toContain('img-src data: blob: https://api.stock.example');
    // WebRTC still neutered even when scoped (it can't be host-limited via CSP)
    expect(out).toContain('delete window.RTCPeerConnection');
  });

  it('no net → defaults to BLOCK (fail closed), not an un-gated doc', () => {
    const out = injectDemoBridge(DOC, '', 'ch', {});
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain('delete window.RTCPeerConnection');
    expect(out).toContain('delete window.WebTransport');
  });
});

// #207: in present mode a focused demo must still advance the deck. The bridge
// forwards slide-advance keys to the presenter unless focus is in something you
// type into. It must run before the demo can stop the event (egui and other
// canvas UIs stop propagation and call preventDefault on every key).
describe('injectDemoBridge forwards slide-advance keys (#207)', () => {
  async function forwarded(body: string, target: (d: Document) => Element) {
    const { JSDOM } = await import('jsdom');
    const html = injectDemoBridge(`<html><head></head><body>${body}</body></html>`, '', 'ch', { net: 'block' });
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const w = dom.window as unknown as Window & typeof globalThis;
    const sent: string[] = [];
    w.parent.postMessage = ((m: { type?: string; key?: string }) => { if (m?.type === 'nav-key') sent.push(m.key!); }) as typeof w.postMessage;
    const el = target(w.document) as HTMLElement;
    el.focus?.();
    for (const key of ['ArrowRight', ' ', 'ArrowLeft']) {
      el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    return sent;
  }

  it('forwards from a demo that stops propagation and prevents default (egui)', async () => {
    const sent = await forwarded(
      '<canvas id="c" tabindex="0"></canvas><script>document.getElementById("c").addEventListener("keydown", function (e) { e.preventDefault(); e.stopPropagation(); });</script>',
      (d) => d.getElementById('c')!,
    );
    expect(sent).toEqual(['ArrowRight', ' ', 'ArrowLeft']);
  });

  it('forwards from a plain demo', async () => {
    expect(await forwarded('<div id="d">demo</div>', (d) => d.getElementById('d')!)).toEqual(['ArrowRight', ' ', 'ArrowLeft']);
  });

  it('does not forward while typing in a text box', async () => {
    expect(await forwarded('<input id="t">', (d) => d.getElementById('t')!)).toEqual([]);
    expect(await forwarded('<textarea id="t"></textarea>', (d) => d.getElementById('t')!)).toEqual([]);
    expect(await forwarded('<div id="t" contenteditable="true">x</div>', (d) => d.getElementById('t')!)).toEqual([]);
  });
});
