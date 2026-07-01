import { describe, it, expect } from 'vitest';
import {
  extensionOf, assetKindForPath, isAllowedExtension,
  isEigendeckDemo, contentMatchesExtension, assetTypeGate,
} from './assetTypes.mjs';

const bytes = (...a) => new Uint8Array(a);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const DEMO = '<!DOCTYPE html>\n<!--eigendeck-demo-v1-->\n<html></html>';
const DEMO_BOM = '﻿<!DOCTYPE html>\n<!--eigendeck-demo-v1--><html></html>';
const DEMO_NO_DOCTYPE = '<!--eigendeck-demo-v1-->\n<html></html>';
const RAW_HTML = '<!DOCTYPE html><html><body>a saved web page</body></html>';
const IPYNB = JSON.stringify({ nbformat: 4, cells: [] });

describe('extension allowlist', () => {
  it('extensionOf handles dirs, dots, case', () => {
    expect(extensionOf('/a/b/fig.PNG')).toBe('png');
    expect(extensionOf('/home/u/.ssh/id_rsa')).toBe('');   // dotfile, no ext
    expect(extensionOf('a.tar.gz')).toBe('gz');
  });
  it('maps allowed extensions to kinds; rejects the rest', () => {
    expect(assetKindForPath('x.png')).toBe('image');
    expect(assetKindForPath('x.ipynb')).toBe('notebook');
    expect(assetKindForPath('x.html')).toBe('demo');
    expect(isAllowedExtension('/etc/passwd')).toBe(false);
    expect(isAllowedExtension('~/.aws/credentials')).toBe(false);
    expect(isAllowedExtension('secret.env')).toBe(false);
  });
});

describe('isEigendeckDemo marker sniff', () => {
  it('accepts the marker after a DOCTYPE', () => {
    expect(isEigendeckDemo(DEMO)).toEqual({ ok: true, version: 1, supported: true });
  });
  it('tolerates a leading BOM', () => {
    expect(isEigendeckDemo(DEMO_BOM).ok).toBe(true);
  });
  it('accepts the marker with no DOCTYPE too', () => {
    expect(isEigendeckDemo(DEMO_NO_DOCTYPE).ok).toBe(true);
  });
  it('rejects ordinary HTML with no marker', () => {
    expect(isEigendeckDemo(RAW_HTML).ok).toBe(false);
  });
  it('rejects a marker that is not at the top (a file merely containing the string)', () => {
    expect(isEigendeckDemo('<html>...<!--eigendeck-demo-v1-->...</html>').ok).toBe(false);
  });
  it('flags an unknown/newer version as unsupported (fail closed)', () => {
    const r = isEigendeckDemo('<!--eigendeck-demo-v99-->');
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(false);
  });
});

describe('contentMatchesExtension', () => {
  it('accepts real magic for the declared type', () => {
    expect(contentMatchesExtension(PNG, 'png')).toBe(true);
    expect(contentMatchesExtension(JPG, 'jpg')).toBe(true);
    expect(contentMatchesExtension(GIF, 'gif')).toBe(true);
    expect(contentMatchesExtension(PDF, 'pdf')).toBe(true);
    expect(contentMatchesExtension('<svg viewBox="0 0 1 1"></svg>', 'svg')).toBe(true);
    expect(contentMatchesExtension(IPYNB, 'ipynb')).toBe(true);
    expect(contentMatchesExtension(DEMO, 'html')).toBe(true);
  });
  it('rejects content that does not match the extension', () => {
    expect(contentMatchesExtension('just text', 'png')).toBe(false);     // secret misnamed .png
    expect(contentMatchesExtension(RAW_HTML, 'html')).toBe(false);       // html but not a demo
    expect(contentMatchesExtension('nope', 'ipynb')).toBe(false);
    expect(contentMatchesExtension('plain', 'svg')).toBe(false);
  });
});

describe('assetTypeGate (the 0th-order rule on a resolved target)', () => {
  it('rejects the exfil classics by extension', () => {
    expect(assetTypeGate('KEYDATA', '/home/u/.ssh/id_rsa')).toMatchObject({ ok: false, reason: 'bad-extension' });
    expect(assetTypeGate('tok', '/home/u/.aws/credentials')).toMatchObject({ ok: false, reason: 'bad-extension' });
  });
  it('rejects a secret misnamed with an allowed extension (symlink target name)', () => {
    // a.png resolved to a text secret → extension ok, content fails
    expect(assetTypeGate('PRIVATE KEY TEXT', '/tmp/a.png')).toMatchObject({ ok: false, reason: 'content-mismatch' });
  });
  it('accepts genuine assets', () => {
    expect(assetTypeGate(PNG, '/deck/fig.png')).toMatchObject({ ok: true, kind: 'image' });
    expect(assetTypeGate(DEMO, '/deck/demo.html')).toMatchObject({ ok: true, kind: 'demo' });
    expect(assetTypeGate(IPYNB, '/deck/nb.ipynb')).toMatchObject({ ok: true, kind: 'notebook' });
  });
  it('rejects raw HTML as a demo (must be a marked eigendeck demo)', () => {
    expect(assetTypeGate(RAW_HTML, '/deck/page.html')).toMatchObject({ ok: false, reason: 'content-mismatch' });
  });
  it('rejects an unsupported demo version distinctly', () => {
    expect(assetTypeGate('<!--eigendeck-demo-v99-->', '/deck/demo.html'))
      .toMatchObject({ ok: false, reason: 'unsupported-demo-version' });
  });
});
