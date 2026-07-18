import { describe, it, expect } from 'vitest';
import {
  markAsEigendeck, markAsEigendeckForClipboard, hasEigendeckMarker, stripEigendeckMarker,
  EIGENDECK_PASTE_MARKER,
} from './clipboard';

describe('eigendeck clipboard marker', () => {
  it('comment-only form round-trips (export/print — no wrapper element)', () => {
    const m = markAsEigendeck('<b>hi</b>');
    expect(m).toBe(EIGENDECK_PASTE_MARKER + '<b>hi</b>');
    expect(hasEigendeckMarker(m)).toBe(true);
    expect(stripEigendeckMarker(m)).toBe('<b>hi</b>');
  });

  it('clipboard form carries BOTH the comment and a data-attribute marker', () => {
    const m = markAsEigendeckForClipboard('<b>hi</b>');
    expect(m).toContain(EIGENDECK_PASTE_MARKER);
    expect(m).toContain('data-eigendeck-copy="v1"');
    expect(hasEigendeckMarker(m)).toBe(true);
  });

  it('is still detected when the comment is stripped (macOS NSPasteboard case)', () => {
    // The reported bug: macOS re-serializes text/html on the pasteboard and drops
    // the leading comment, so an eigendeck copy pasted back was NOT recognized and
    // came in as raw (baked-color) text. The data attribute must survive.
    const clip = markAsEigendeckForClipboard('<div style="color:#fff">white text</div>');
    const withoutComment = clip.replace(EIGENDECK_PASTE_MARKER, '');
    expect(withoutComment).not.toContain('eigendeck-copy:v1'); // comment gone
    expect(hasEigendeckMarker(withoutComment)).toBe(true);      // data attribute survives
  });

  it('strips both markers (leaving the plain wrapper content)', () => {
    const stripped = stripEigendeckMarker(markAsEigendeckForClipboard('<b>hi</b>'));
    expect(stripped).not.toContain('data-eigendeck-copy');
    expect(stripped).not.toContain(EIGENDECK_PASTE_MARKER);
    expect(stripped).toContain('<b>hi</b>');
  });

  it('does not false-positive on foreign HTML', () => {
    expect(hasEigendeckMarker('<div><p>Word text</p></div>')).toBe(false);
    expect(hasEigendeckMarker('plain')).toBe(false);
    expect(hasEigendeckMarker('')).toBe(false);
  });
});
