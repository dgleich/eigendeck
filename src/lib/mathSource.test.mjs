// #208: the "Typeset math" setting (global → deck → element) and the \$ escape.
import { describe, it, expect } from 'vitest';
import { effectiveTypesetMath, mathSourceHtml, elementMathHtml, mathSourcePlain } from './mathSource.mjs';

describe('effectiveTypesetMath', () => {
  it('element value wins over the deck', () => {
    expect(effectiveTypesetMath({ typesetMath: false }, { typesetMath: true })).toBe(false);
    expect(effectiveTypesetMath({ typesetMath: true }, { typesetMath: false })).toBe(true);
  });
  it('an element without a value follows the deck', () => {
    expect(effectiveTypesetMath({}, { typesetMath: false })).toBe(false);
    expect(effectiveTypesetMath({}, { typesetMath: true })).toBe(true);
  });
  it('a deck without the field (every older deck) typesets', () => {
    expect(effectiveTypesetMath({}, {})).toBe(true);
    expect(effectiveTypesetMath({}, undefined)).toBe(true);
    expect(effectiveTypesetMath(undefined, undefined)).toBe(true);
  });
});

describe('mathSourceHtml', () => {
  it('typesetting on: leaves real delimiters, hides escaped dollars from every math finder', () => {
    expect(mathSourceHtml('Pay \\$5 for $x^2$', true)).toBe('Pay &#36;5 for $x^2$');
  });
  it('typesetting off: every dollar becomes literal, escaped or not', () => {
    expect(mathSourceHtml('He got $5 million and $6 million, or \\$7', false))
      .toBe('He got &#36;5 million and &#36;6 million, or &#36;7');
  });
  it('never touches dollars inside tags', () => {
    expect(mathSourceHtml('<span data-x="$a$">$5</span>', false)).toBe('<span data-x="$a$">&#36;5</span>');
    expect(mathSourceHtml('<span data-x="\\$">\\$5</span>', true)).toBe('<span data-x="\\$">&#36;5</span>');
  });
  it('returns non-strings as an empty string and leaves dollar-free html unchanged', () => {
    expect(mathSourceHtml(undefined, true)).toBe('');
    expect(mathSourceHtml('<b>plain</b>', false)).toBe('<b>plain</b>');
  });
});

describe('elementMathHtml', () => {
  it('applies the resolved setting to the element html', () => {
    const cfg = { typesetMath: false };
    expect(elementMathHtml({ type: 'text', html: '$x$' }, cfg)).toBe('&#36;x&#36;');
    expect(elementMathHtml({ type: 'text', html: '$x$', typesetMath: true }, cfg)).toBe('$x$');
  });
});

describe('mathSourcePlain', () => {
  it('turns the escape into a plain dollar for plain-text uses (alt text, clipboard text)', () => {
    expect(mathSourcePlain('Pay \\$5 for $x$')).toBe('Pay $5 for $x$');
  });
});
