import { describe, it, expect } from 'vitest';
import {
  fileUrlToPath, assetRefForPath, parseUriList, parseGnomeCopiedFiles, assetRefsFromPaths,
} from './pasteFile';

describe('fileUrlToPath', () => {
  it('decodes a file:// URL to a path (percent-decoded)', () => {
    expect(fileUrlToPath('file:///Users/foo/bar%20baz.png')).toBe('/Users/foo/bar baz.png');
    expect(fileUrlToPath('file:///home/dg/a+b/c.svg')).toBe('/home/dg/a+b/c.svg');
  });
  it('ignores a host/authority component', () => {
    expect(fileUrlToPath('file://localhost/Users/foo/x.pdf')).toBe('/Users/foo/x.pdf');
  });
  it('accepts a bare absolute path (NSFilenames / CF_HDROP)', () => {
    expect(fileUrlToPath('/Users/foo/x.png')).toBe('/Users/foo/x.png');
    expect(fileUrlToPath('C:\\Users\\foo\\x.png')).toBe('C:\\Users\\foo\\x.png');
  });
  it('rejects non-file schemes and junk', () => {
    expect(fileUrlToPath('https://example.com/x.png')).toBeNull();
    expect(fileUrlToPath('data:image/png;base64,AAAA')).toBeNull();
    expect(fileUrlToPath('relative/path.png')).toBeNull();
    expect(fileUrlToPath('')).toBeNull();
    expect(fileUrlToPath('   ')).toBeNull();
  });
});

describe('assetRefForPath', () => {
  it('accepts image/svg/pdf and infers mime + kind + filename', () => {
    expect(assetRefForPath('/a/b/pic.PNG')).toEqual({ path: '/a/b/pic.PNG', fileName: 'pic.PNG', ext: 'png', mime: 'image/png', kind: 'raster' });
    expect(assetRefForPath('/a/b/logo.svg')).toMatchObject({ mime: 'image/svg+xml', kind: 'svg' });
    expect(assetRefForPath('/a/b/doc.pdf')).toMatchObject({ mime: 'application/pdf', kind: 'pdf' });
    expect(assetRefForPath('/a/b/photo.jpeg')).toMatchObject({ mime: 'image/jpeg', kind: 'raster' });
    expect(assetRefForPath('C:\\x\\y\\z.webp')).toMatchObject({ fileName: 'z.webp', mime: 'image/webp' });
  });
  it('rejects non-asset extensions', () => {
    expect(assetRefForPath('/a/b/notes.txt')).toBeNull();
    expect(assetRefForPath('/a/b/movie.mp4')).toBeNull();   // video files are not pasted here (#172)
    expect(assetRefForPath('/a/b/archive.zip')).toBeNull();
    expect(assetRefForPath('/a/b/noext')).toBeNull();
  });
});

describe('parseUriList', () => {
  it('parses CRLF-separated file URIs, ignoring comments/blanks', () => {
    const text = '# comment\r\nfile:///a/b/one.png\r\nfile:///a/b/two.svg\r\n';
    expect(parseUriList(text)).toEqual(['/a/b/one.png', '/a/b/two.svg']);
  });
  it('drops non-file URIs', () => {
    expect(parseUriList('file:///a/x.png\nhttps://y/z.png')).toEqual(['/a/x.png']);
  });
});

describe('parseGnomeCopiedFiles', () => {
  it('drops the leading copy/cut op line', () => {
    expect(parseGnomeCopiedFiles('copy\nfile:///a/x.png\nfile:///a/y.pdf')).toEqual(['/a/x.png', '/a/y.pdf']);
    expect(parseGnomeCopiedFiles('cut\nfile:///a/x.png')).toEqual(['/a/x.png']);
  });
  it('works without an op line', () => {
    expect(parseGnomeCopiedFiles('file:///a/x.png')).toEqual(['/a/x.png']);
  });
});

describe('assetRefsFromPaths', () => {
  it('keeps asset files in order, dedups by path, skips non-assets', () => {
    const refs = assetRefsFromPaths(['/a/x.png', '/a/notes.txt', '/a/y.svg', '/a/x.png']);
    expect(refs.map((r) => r.fileName)).toEqual(['x.png', 'y.svg']);
  });
  it('empty when nothing is an asset', () => {
    expect(assetRefsFromPaths(['/a/a.txt', '/a/b.mp4'])).toEqual([]);
  });
});
