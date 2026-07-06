import { describe, it, expect } from 'vitest';
import { parseDemoManifest, manifestHosts, hostsToCspSources } from './demoManifest';

const withManifest = (json: string) =>
  `<html><head><script type="application/eigendeck-manifest+json">${json}</script></head><body></body></html>`;

describe('parseDemoManifest', () => {
  it('parses a valid network manifest (host + purpose)', () => {
    const m = parseDemoManifest(withManifest('{"network":[{"host":"api.x","purpose":"quotes"},{"host":"cdn.y","purpose":"lib"}]}'));
    expect(m?.network).toEqual([{ host: 'api.x', purpose: 'quotes' }, { host: 'cdn.y', purpose: 'lib' }]);
  });
  it('returns null when there is no manifest', () => {
    expect(parseDemoManifest('<html><body><div>hi</div></body></html>')).toBeNull();
  });
  it('is tolerant of invalid JSON / missing hosts', () => {
    expect(parseDemoManifest(withManifest('{not json'))).toBeNull();
    const m = parseDemoManifest(withManifest('{"network":[{"purpose":"no host"},{"host":"ok.x"}]}'));
    expect(m?.network).toEqual([{ host: 'ok.x', purpose: '' }]);
  });
});

describe('manifestHosts', () => {
  it('returns [] when no manifest (→ demo gets no internet)', () => {
    expect(manifestHosts('<div>plain</div>')).toEqual([]);
  });
  it('dedupes declared hosts', () => {
    expect(manifestHosts(withManifest('{"network":[{"host":"a.x","purpose":"1"},{"host":"a.x","purpose":"2"}]}'))).toEqual(['a.x']);
  });
});

describe('hostsToCspSources', () => {
  it('bare host → https + wss; full origin → verbatim', () => {
    expect(hostsToCspSources(['api.x'])).toBe('https://api.x wss://api.x');
    expect(hostsToCspSources(['http://localhost:8888'])).toBe('http://localhost:8888');
  });
  it('accepts *.subdomain and host:port', () => {
    expect(hostsToCspSources(['*.example.com'])).toBe('https://*.example.com wss://*.example.com');
    expect(hostsToCspSources(['cdn.x:8443'])).toBe('https://cdn.x:8443 wss://cdn.x:8443');
  });
  it('REJECTS injection / wildcard / junk hosts (CSP-safe)', () => {
    // ; and " would inject directives / break out of the <meta content="..."> attr
    expect(hostsToCspSources(['evil.test; script-src https:'])).toBe('');
    expect(hostsToCspSources(['x"><script>alert(1)</script>'])).toBe('');
    expect(hostsToCspSources(['a b'])).toBe('');            // space
    expect(hostsToCspSources(['*'])).toBe('');              // bare wildcard = whole internet
    expect(hostsToCspSources(['https://*'])).toBe('');
    // a valid host alongside junk still comes through; junk is dropped
    expect(hostsToCspSources(['ok.x', 'bad;host'])).toBe('https://ok.x wss://ok.x');
  });
});
