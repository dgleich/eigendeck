import { describe, it, expect } from 'vitest';
import { injectDemoBridge } from './demoBridge';

const DOC = '<html><head></head><body><div>demo</div></body></html>';

describe('injectDemoBridge network policy', () => {
  it("net:'block' → connect-src 'none' across every channel + WebRTC neuter", () => {
    const out = injectDemoBridge(DOC, '', 'ch', { net: 'block' });
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("form-action 'none'");
    expect(out).not.toContain("script-src 'none'"); // demo still runs + renders
    expect(out).toContain('delete window.RTCPeerConnection');
    // CSP must precede the demo (first in <head> to be honored)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<div>demo</div>'));
  });

  it('net:{hosts} → connect-src SCOPED to the declared hosts (https + wss)', () => {
    const out = injectDemoBridge(DOC, '', 'ch', { net: { hosts: ['api.stock.example', 'http://localhost:8888'] } });
    expect(out).toContain('connect-src https://api.stock.example wss://api.stock.example http://localhost:8888');
    expect(out).not.toContain("connect-src 'none'");
    // the scoped hosts also open img/media/font (a declared host can serve those)
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
