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
    expect(out).toMatch(/script-src 'unsafe-inline';/);   // nothing after unsafe-inline → no CDN
    expect(out).toContain('delete window.RTCPeerConnection');
    // CSP must precede the demo (first in <head> to be honored)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<div>demo</div>'));
  });

  it('net:{hosts} → declared hosts scope connect AND script/style/img/media/font', () => {
    const out = injectDemoBridge(DOC, '', 'ch', { net: { hosts: ['api.stock.example', 'http://localhost:8888'] } });
    expect(out).toContain('connect-src https://api.stock.example wss://api.stock.example http://localhost:8888');
    expect(out).not.toContain("connect-src 'none'");
    // a declared CDN can serve the demo's scripts + styles + assets
    expect(out).toContain("script-src 'unsafe-inline' https://api.stock.example wss://api.stock.example http://localhost:8888");
    expect(out).toContain("style-src 'unsafe-inline' https://api.stock.example");
    expect(out).toContain('img-src data: blob: https://api.stock.example');
    // WebRTC still neutered even when scoped (it can't be host-limited via CSP)
    expect(out).toContain('delete window.RTCPeerConnection');
  });

  it('no net → no CSP / neuter injected', () => {
    const out = injectDemoBridge(DOC, '', 'ch', {});
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).not.toContain('delete window.RTCPeerConnection');
  });
});
