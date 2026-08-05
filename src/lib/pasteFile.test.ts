import { describe, it, expect } from 'vitest';
import {
  fileUrlToPath, parseUriList, parseGnomeCopiedFiles, parseNSFilenames,
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


describe('parseNSFilenames (real Finder plist)', () => {
  // The EXACT plist NSFilenamesPboardType carried when copying a PDF in Finder
  // (captured via Debug → Dump Pasteboard Types). public.file-url there is a
  // useless /.file/id= reference; this type has the real path.
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
    <string>/Users/dgleich/Dropbox/courses/cs520-2026/grades/midterm-density.pdf</string>
</array>
</plist>`;
  it('extracts the real POSIX path (the copied-PDF case that made a filename textbox)', () => {
    expect(parseNSFilenames(plist)).toEqual(['/Users/dgleich/Dropbox/courses/cs520-2026/grades/midterm-density.pdf']);
  });
  it('handles multiple files + file:// entries + XML entities', () => {
    const multi = '<plist><array>'
      + '<string>/a/one.png</string>'
      + '<string>file:///a/two%20b.svg</string>'
      + '<string>/a/A&amp;B.jpg</string>'
      + '</array></plist>';
    expect(parseNSFilenames(multi)).toEqual(['/a/one.png', '/a/two b.svg', '/a/A&B.jpg']);
  });
  it('empty for a plist with no strings', () => {
    expect(parseNSFilenames('<plist><array></array></plist>')).toEqual([]);
    expect(parseNSFilenames('')).toEqual([]);
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

