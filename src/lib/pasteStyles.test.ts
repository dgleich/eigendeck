import { describe, it, expect } from 'vitest';
import { pasteTextToElementHtml } from './pasteText';

// The styling contract for a TEXT-branch paste (docs/copy-and-paste.md):
// Eigendeck's format toolbar authors only bold / italic / strikethrough /
// foreground-color / lists / alignment / uppercase — NOT underline, font-size,
// or font-family. So a paste must:
//   • strip a color applied to the WHOLE string (a source default), keep sub-range colors,
//   • keep bold / italic / strikethrough,
//   • drop underline (we have none) but keep line-through,
//   • drop font-size / font-family (adopt the target preset).
// This is the full matrix; each row is `pasteTextToElementHtml(html, plain?)`.

type Case = {
  name: string;
  html: string;
  plain?: string;
  keep?: (string | RegExp)[];   // must survive
  drop?: (string | RegExp)[];   // must be gone
};

const CASES: Case[] = [
  // ---- whole-string color → stripped, across every notation ----
  { name: 'whole-string color #c00 (short hex)', html: '<span style="color:#c00">Hi</span>', keep: ['Hi'], drop: [/color/i] },
  { name: 'whole-string color #cc0000 (long hex)', html: '<span style="color:#cc0000">Hi</span>', keep: ['Hi'], drop: [/color/i] },
  { name: 'whole-string color rgb()', html: '<span style="color:rgb(200,0,0)">Hi</span>', keep: ['Hi'], drop: [/color/i, /rgb/i] },
  { name: 'whole-string color named', html: '<span style="color:red">Hi</span>', keep: ['Hi'], drop: [/color/i] },
  { name: 'whole-string <font color>', html: '<font color="#c00">Hi</font>', keep: ['Hi'], drop: [/color=/i] },
  { name: 'whole-string color + bold: color out, bold kept', html: '<b style="color:#c00">Hi</b>', keep: ['Hi', /<(b|strong)|font-weight/i], drop: [/color/i] },

  // ---- sub-range color → kept (intentional highlight) ----
  { name: 'sub-range color span kept', html: 'Here <span style="color:#008000">is</span> text', keep: ['is', /color/i, '008000'] },
  { name: 'sub-range <font color> kept', html: 'Here <font color="#008000">is</font> text', keep: ['is', /color/i] },
  { name: 'two sub-range colors both kept', html: '<span style="color:#008000">a</span>-<span style="color:#0000ff">b</span>',
    keep: ['a', 'b', '008000', '0000ff'] },
  { name: 'nested: whole-string wrapper stripped, inner sub-range kept',
    html: '<span style="color:#c00">Here <span style="color:#008000">is</span> text</span>',
    keep: ['is', '008000'], drop: ['#c00', 'cc0000'] },

  // ---- bold / italic / strikethrough → kept ----
  { name: 'bold <b> kept', html: '<b>x</b>', keep: [/<(b|strong)\b/i] },
  { name: 'bold <strong> kept', html: '<strong>x</strong>', keep: [/<(b|strong)\b/i] },
  { name: 'italic <i> kept', html: '<i>x</i>', keep: [/<(i|em)\b/i] },
  { name: 'italic <em> kept', html: '<em>x</em>', keep: [/<(i|em)\b/i] },
  { name: 'strike <s> kept', html: '<s>x</s>', keep: [/<(s|strike|del)\b|line-through/i] },
  { name: 'strike <strike> kept', html: '<strike>x</strike>', keep: [/<(s|strike|del)\b|line-through/i] },
  { name: 'strike text-decoration:line-through kept', html: '<span style="text-decoration:line-through">x</span>',
    keep: [/line-through/i] },

  // ---- underline → dropped, line-through preserved ----
  { name: 'underline <u> unwrapped, text kept', html: '<u>under</u>', keep: ['under'], drop: [/<u\b/i] },
  { name: 'underline text-decoration dropped', html: '<span style="text-decoration:underline">x</span>',
    keep: ['x'], drop: [/underline/i] },
  { name: 'underline + line-through: underline out, strike kept',
    html: '<span style="text-decoration:underline line-through">x</span>',
    keep: [/line-through/i], drop: [/underline/i] },

  // ---- multi-block uniform default color → stripped (Word/Docs emit the same
  //      color on every paragraph; each <p> covers only part of the text, so the
  //      per-element whole-string check misses it and it stays invisible on dark) ----
  { name: 'two same-color paragraphs (uniform default) → color stripped',
    html: '<p style="color:#000000">First line</p><p style="color:#000000">Second line</p>',
    keep: ['First line', 'Second line'], drop: [/color/i] },
  { name: 'three uniform black blocks → all stripped',
    html: '<div style="color:#000">a</div><div style="color:#000">b</div><div style="color:#000">c</div>',
    keep: ['a', 'b', 'c'], drop: [/color/i] },
  { name: 'two DIFFERENT-color paragraphs → both kept (not a uniform default)',
    html: '<p style="color:#008000">green para</p><p style="color:#0000ff">blue para</p>',
    keep: ['green para', 'blue para', '008000', '0000ff'] },

  // ---- font-size / font-family → dropped ----
  { name: 'font-size dropped', html: '<span style="font-size:48px">big</span>', keep: ['big'], drop: [/font-size/i, /48px/i] },
  { name: 'font-family dropped', html: '<span style="font-family:Comic Sans">x</span>', keep: ['x'], drop: [/font-family/i] },
  { name: 'font-size + family + whole-string color all dropped',
    html: '<span style="font-size:48px;font-family:Comic Sans;color:red">big</span>',
    keep: ['big'], drop: [/font-size/i, /font-family/i, /color/i] },
];

describe('paste style normalization matrix', () => {
  it.each(CASES)('$name', ({ html, plain, keep, drop }) => {
    const out = (pasteTextToElementHtml(html, plain ?? 'fallback') || '').toString();
    for (const k of keep ?? []) {
      if (k instanceof RegExp) expect(out).toMatch(k);
      else expect(out).toContain(k);
    }
    for (const d of drop ?? []) {
      if (d instanceof RegExp) expect(out).not.toMatch(d);
      else expect(out).not.toContain(d);
    }
  });
});
