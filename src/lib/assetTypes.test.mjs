import { describe, it, expect } from 'vitest';
import {
  extensionOf, assetKindForPath, isAllowedExtension,
  isEigendeckDemo, contentMatchesExtension, assetTypeGate, NOTEBOOK_MAX_BYTES,
  ASSET_EXTENSIONS,
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

describe('adversarial + regression cases', () => {
  const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
  const MP4 = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);

  it('id_rsa.png double-extension with non-PNG bytes → content-mismatch (content is the sole barrier)', () => {
    expect(assetTypeGate('-----BEGIN OPENSSH PRIVATE KEY-----', '/tmp/id_rsa.png'))
      .toMatchObject({ ok: false, reason: 'content-mismatch' });
  });
  it('.jpeg content match works (mapped but previously untested)', () => {
    expect(contentMatchesExtension(JPG, 'jpeg')).toBe(true);
    expect(assetTypeGate(JPG, '/deck/photo.jpeg')).toMatchObject({ ok: true, kind: 'image' });
  });
  it('webp / mp4 / mov offset magic', () => {
    expect(contentMatchesExtension(WEBP, 'webp')).toBe(true);
    expect(contentMatchesExtension(MP4, 'mp4')).toBe(true);
    expect(contentMatchesExtension(MP4, 'mov')).toBe(true);
    expect(contentMatchesExtension(bytes(0x66, 0x74, 0x79, 0x70), 'mp4')).toBe(false); // ftyp at offset 0, not 4
  });
  it('accepts the extra media/caption types the pickers allow', () => {
    const OGG = bytes(0x4f, 0x67, 0x67, 0x53, 0, 0);
    expect(contentMatchesExtension(OGG, 'ogg')).toBe(true);
    expect(contentMatchesExtension(OGG, 'ogv')).toBe(true);
    expect(contentMatchesExtension(MP4, 'm4v')).toBe(true);          // m4v is ISO-BMFF (ftyp)
    expect(contentMatchesExtension('WEBVTT\n\n00:00.000 --> 00:01.000\nhi', 'vtt')).toBe(true);
    expect(assetTypeGate('WEBVTT\n', '/deck/subs.vtt')).toMatchObject({ ok: true, kind: 'captions' });
    // and they reject mismatched content
    expect(contentMatchesExtension('not ogg', 'ogg')).toBe(false);
    expect(contentMatchesExtension('not vtt', 'vtt')).toBe(false);
  });

  it('empty / truncated input returns false, never throws', () => {
    expect(contentMatchesExtension(bytes(), 'png')).toBe(false);
    expect(contentMatchesExtension(bytes(0x89, 0x50, 0x4e), 'png')).toBe(false); // partial magic
    expect(isEigendeckDemo(bytes()).ok).toBe(false);
    expect(assetTypeGate(bytes(), '/deck/x.png')).toMatchObject({ ok: false });
  });
  it('marker tolerates whitespace before DOCTYPE and between DOCTYPE and marker', () => {
    expect(isEigendeckDemo('  \n<!DOCTYPE html>\n\n  <!--eigendeck-demo-v1-->').ok).toBe(true);
  });
  it('marker is case-sensitive and rejects leading-zero versions ("exact bytes")', () => {
    expect(isEigendeckDemo('<!--EIGENDECK-DEMO-V1-->').ok).toBe(false);
    expect(isEigendeckDemo('<!--eigendeck-demo-v01-->').ok).toBe(false);
  });
  it('svg must be a LEADING <svg root, not just contain the string', () => {
    expect(contentMatchesExtension('<?xml version="1.0"?><svg></svg>', 'svg')).toBe(true);
    expect(contentMatchesExtension('a note mentioning <svg> in prose', 'svg')).toBe(false);
  });
  it('svg accepts a leading <!DOCTYPE svg …> prolog (Illustrator / Inkscape)', () => {
    expect(contentMatchesExtension('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'svg')).toBe(true);
    expect(contentMatchesExtension('<!DOCTYPE svg>\n<svg></svg>', 'svg')).toBe(true);
    // but a non-svg doctype is not an svg
    expect(contentMatchesExtension('<!DOCTYPE html>\n<svg></svg>', 'svg')).toBe(false);
  });
  it('vtt requires WEBVTT to be terminated (space/tab/newline/EOF), not a prefix', () => {
    expect(contentMatchesExtension('WEBVTT', 'vtt')).toBe(true);            // EOF
    expect(contentMatchesExtension('WEBVTT\n\n00:00.000 --> 00:01.000\nhi', 'vtt')).toBe(true);
    expect(contentMatchesExtension('WEBVTT - Some title', 'vtt')).toBe(true);
    expect(contentMatchesExtension('WEBVTTX not really vtt', 'vtt')).toBe(false); // prefix, not a real header
  });
  it('a notebook over NOTEBOOK_MAX_BYTES is rejected without parsing', () => {
    const over = new Uint8Array(NOTEBOOK_MAX_BYTES + 1); // one byte past the cap
    expect(contentMatchesExtension(over, 'ipynb')).toBe(false);
  });

  it('contentMatchesExtension and assetTypeGate never disagree (one code path)', () => {
    const cases = [
      [PNG, 'png'], ['text', 'png'], [DEMO, 'html'], [RAW_HTML, 'html'],
      ['<!--eigendeck-demo-v99-->', 'html'], [IPYNB, 'ipynb'], ['x', 'svg'],
    ];
    for (const [input, ext] of cases) {
      expect(assetTypeGate(input, `f.${ext}`).ok).toBe(contentMatchesExtension(input, ext));
    }
  });
});

// ============================================================================
// Exhaustive "fake asset" matrix. The security promise is: a file is accepted
// ONLY when its BYTES match the type its EXTENSION claims. These loops cover the
// full cross-product so a fake of any type — a secret misnamed .png, an mp4 blob
// called .webm, raw HTML posing as a demo — is provably rejected, and every
// genuine (bytes,ext) pairing is provably accepted. See docs/ASSETS-SECURITY.md.
describe('fake-asset matrix — every content family × every allowed extension', () => {
  // One canonical, minimal-but-VALID sample per format, with the extension(s) that
  // format is legitimately valid for. Everything off the diagonal is a "fake".
  const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
  const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0);
  const OGG  = bytes(0x4f, 0x67, 0x67, 0x53, 0, 0);
  const MP4  = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
  const SVG  = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const VTT  = 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n';
  const SAMPLES = [
    { name: 'png',       data: PNG,   valid: ['png'] },
    { name: 'jpg',       data: JPG,   valid: ['jpg', 'jpeg'] },
    { name: 'gif',       data: GIF,   valid: ['gif'] },
    { name: 'webp',      data: WEBP,  valid: ['webp'] },
    { name: 'pdf',       data: PDF,   valid: ['pdf'] },
    { name: 'webm',      data: WEBM,  valid: ['webm'] },
    { name: 'ogg',       data: OGG,   valid: ['ogg', 'ogv'] },   // OggS covers .ogg + .ogv
    { name: 'mp4',       data: MP4,   valid: ['mp4', 'mov', 'm4v'] }, // ISO-BMFF ftyp
    { name: 'svg',       data: SVG,   valid: ['svg'] },
    { name: 'ipynb',     data: IPYNB, valid: ['ipynb'] },
    { name: 'vtt',       data: VTT,   valid: ['vtt'] },
    { name: 'demo-html', data: DEMO,  valid: ['html'] },
  ];
  const EXTS = Object.keys(ASSET_EXTENSIONS);

  for (const s of SAMPLES) {
    for (const ext of EXTS) {
      const accept = s.valid.includes(ext);
      it(`${s.name} bytes as .${ext} → ${accept ? 'accepted' : 'REJECTED (fake)'}`, () => {
        expect(contentMatchesExtension(s.data, ext)).toBe(accept);
        // the full gate (judged on the resolved path's extension) must agree
        const g = assetTypeGate(s.data, `/deck/file.${ext}`);
        expect(g.ok).toBe(accept);
        if (accept) expect(g.kind).toBe(ASSET_EXTENSIONS[ext]);
      });
    }
  }
});

describe('fake-asset matrix — garbage content is rejected for every allowed extension', () => {
  const GARBAGE = [
    ['plain text',      'this is definitely not a real asset'],
    ['all zeros',       bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)],
    ['ssh private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n'],
    ['empty',           bytes()],
  ];
  for (const ext of Object.keys(ASSET_EXTENSIONS)) {
    for (const [label, g] of GARBAGE) {
      it(`${label} misnamed .${ext} → rejected (content-mismatch)`, () => {
        expect(contentMatchesExtension(g, ext)).toBe(false);
        expect(assetTypeGate(g, `/deck/x.${ext}`).ok).toBe(false);
      });
    }
  }
});

describe('fake-asset matrix — non-allowlisted extensions are refused whatever the bytes', () => {
  // Even real PNG bytes can't sneak in under a disallowed extension — the extension
  // gate fires first (bad-extension), before content is ever considered.
  const BAD = ['exe', 'sh', 'txt', 'pem', 'key', 'env', 'js', 'css', 'zip', 'doc', ''];
  for (const ext of BAD) {
    it(`.${ext || '(no ext)'} → bad-extension even with genuine PNG bytes`, () => {
      const path = ext ? `/deck/file.${ext}` : '/deck/file';
      expect(assetTypeGate(PNG, path)).toMatchObject({ ok: false, reason: 'bad-extension' });
    });
  }
});
