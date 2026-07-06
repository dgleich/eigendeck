import { describe, it, expect } from 'vitest';
import { injectDemoBridge } from './demoBridge';

const DOC = '<html><head></head><body><div>demo</div></body></html>';

describe('injectDemoBridge blockInternet (net-block enforcement)', () => {
  it('injects a connect-src lockdown + WebRTC neuter when blockInternet is set', () => {
    const out = injectDemoBridge(DOC, '', 'ch', { blockInternet: true });
    // CSP meta closes every egress channel...
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("form-action 'none'");
    // ...but leaves script-src/style-src unset so the demo still runs + renders
    expect(out).not.toContain("script-src 'none'");
    // WebRTC (the CSP blind spot) is deleted before demo code runs
    expect(out).toContain('delete window.RTCPeerConnection');
    expect(out).toContain('delete window.webkitRTCPeerConnection');
    // the CSP meta precedes the bridge/demo (must be first in <head> to be honored)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<div>demo</div>'));
  });

  it('does NOT inject the net-block when internet is allowed', () => {
    const out = injectDemoBridge(DOC, '', 'ch', {});
    expect(out).not.toContain("connect-src 'none'");
    expect(out).not.toContain('delete window.RTCPeerConnection');
  });
});
