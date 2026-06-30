import { describe, it, expect } from 'vitest';
import { bytesToBase64 } from './base64';

// @simplify-guard — pins the extracted chunked base64 encoder to the behavior of
// the inlined loops it replaced (App.tsx ×2, previewCache.ts). Safe to prune once
// the shared util is trusted.
describe('[simplify-guard] bytesToBase64', () => {
  it('matches btoa for a small buffer', () => {
    expect(bytesToBase64(new Uint8Array([72, 105]))).toBe(btoa('Hi'));
  });
  it('round-trips through atob', () => {
    const b = new Uint8Array([0, 1, 2, 127, 128, 200, 255]);
    const out = Uint8Array.from(atob(bytesToBase64(b)), (c) => c.charCodeAt(0));
    expect(Array.from(out)).toEqual(Array.from(b));
  });
  it('empty buffer → empty string', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });
  it('crosses the 8192-byte chunk boundary without corruption', () => {
    const n = 20000, b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = i % 256;
    const dec = atob(bytesToBase64(b));
    expect(dec.length).toBe(n);
    expect(dec.charCodeAt(8192)).toBe(8192 % 256);
    expect(dec.charCodeAt(n - 1)).toBe((n - 1) % 256);
  });

  // @simplify-guard — assetRenderer.ts had a `subarray`-based copy; this proves
  // the shared `slice`-based helper produces byte-identical output, so routing
  // that caller through it is safe.
  it('matches the old subarray-based variant across the chunk boundary', () => {
    const n = 17000, b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) % 256;
    let ref = '';
    for (let i = 0; i < b.length; i += 8192) ref += String.fromCharCode(...b.subarray(i, i + 8192));
    expect(bytesToBase64(b)).toBe(btoa(ref));
  });
});
