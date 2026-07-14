import { describe, it, expect } from 'vitest';
import {
  parseHtmlVars, validateVarValue, resolveVars, stripVarsManifest, isValidColor,
  isTintToken, isColorValue, tintBase, spliceHtmlVars, resolveColorVar,
} from './htmlVars.mjs';

const manifest = (obj) =>
  `<script type="application/eigendeck-vars+json">${JSON.stringify(obj)}</script>`;

describe('parseHtmlVars', () => {
  it('returns [] with no manifest', () => {
    expect(parseHtmlVars('<div>hi</div>')).toEqual([]);
    expect(parseHtmlVars('')).toEqual([]);
    expect(parseHtmlVars(null)).toEqual([]);
  });

  it('parses typed vars in declaration order', () => {
    const html = manifest({
      value: { type: 'float', default: 62, min: 0, max: 100, step: 0.5, label: 'Value', help: 'Needle', width: 72 },
      fill: { type: 'color', default: '#e11d48' },
      unit: { type: 'string', default: '%' },
    });
    const specs = parseHtmlVars(html);
    expect(specs.map((s) => s.name)).toEqual(['value', 'fill', 'unit']);
    expect(specs[0]).toEqual({
      name: 'value', type: 'float', default: 62, min: 0, max: 100, step: 0.5,
      label: 'Value', help: 'Needle', width: 72,
    });
    expect(specs[1]).toMatchObject({ name: 'fill', type: 'color', default: '#e11d48' });
    expect(specs[2]).toMatchObject({ name: 'unit', type: 'string', default: '%' });
  });

  it('coerces int defaults and drops invalid entries', () => {
    const specs = parseHtmlVars(manifest({
      n: { type: 'int', default: 3.7 },
      bad: { type: 'nope', default: 1 },
      '9leading': { type: 'int', default: 1 },
      badcolor: { type: 'color', default: 'not-a-color' },
    }));
    expect(specs.map((s) => s.name)).toEqual(['n', 'badcolor']);
    expect(specs[0].default).toBe(4);
    expect(specs[1].default).toBe('#000000'); // invalid color default → fallback
  });

  it('survives malformed JSON', () => {
    expect(parseHtmlVars('<script type="application/eigendeck-vars+json">{oops</script>')).toEqual([]);
  });
});

describe('validateVarValue', () => {
  const f = { name: 'v', type: 'float', default: 0, min: 0, max: 100 };
  it('range-checks numbers', () => {
    expect(validateVarValue(f, '50')).toEqual({ ok: true, value: 50 });
    expect(validateVarValue(f, 150).ok).toBe(false);
    expect(validateVarValue(f, -1).ok).toBe(false);
    expect(validateVarValue(f, 'abc').ok).toBe(false);
    expect(validateVarValue(f, '').ok).toBe(false);
  });
  it('rejects non-integers for int', () => {
    const i = { name: 'v', type: 'int', default: 0 };
    expect(validateVarValue(i, '3').ok).toBe(true);
    expect(validateVarValue(i, '3.5').ok).toBe(false);
  });
  it('validates colors', () => {
    const c = { name: 'v', type: 'color', default: '#000' };
    expect(validateVarValue(c, '#e11d48').ok).toBe(true);
    expect(validateVarValue(c, 'rebeccapurple').ok).toBe(false); // not in the pragmatic set
    expect(validateVarValue(c, 'red').ok).toBe(true);
    expect(validateVarValue(c, 'xyz').ok).toBe(false);
  });
});

describe('resolveVars', () => {
  it('falls back to defaults for missing/invalid stored values', () => {
    const specs = parseHtmlVars(manifest({
      a: { type: 'float', default: 5, min: 0, max: 10 },
      b: { type: 'string', default: 'hi' },
    }));
    expect(resolveVars(specs, { a: 8 })).toEqual({ a: 8, b: 'hi' });
    expect(resolveVars(specs, { a: 999 })).toEqual({ a: 5, b: 'hi' }); // out of range → default
    expect(resolveVars(specs, undefined)).toEqual({ a: 5, b: 'hi' });
  });
});

describe('stripVarsManifest', () => {
  it('removes the manifest block', () => {
    const html = `before${manifest({ a: { type: 'int', default: 1 } })}after`;
    expect(stripVarsManifest(html)).toBe('beforeafter');
  });
});

describe('tint tokens', () => {
  it('recognises tint:<base>', () => {
    expect(isTintToken('tint:accent')).toBe(true);
    expect(isTintToken('tint:#dc2626')).toBe(true);
    expect(isTintToken('tint:garbage')).toBe(false);
    expect(isTintToken('#dc2626')).toBe(false); // a literal, not a token
    expect(tintBase('tint:accent')).toBe('accent');
    expect(tintBase('#fff')).toBe('');
  });
  it('a color value may be a literal OR a tint token', () => {
    expect(isColorValue('#e11d48')).toBe(true);
    expect(isColorValue('tint:accent')).toBe(true);
    expect(isColorValue('nope')).toBe(false);
  });
  it('parser + validator accept a tint token default/value', () => {
    const [spec] = parseHtmlVars(
      '<script type="application/eigendeck-vars+json">{"c":{"type":"color","default":"tint:accent"}}</script>',
    );
    expect(spec.default).toBe('tint:accent');
    expect(validateVarValue(spec, 'tint:#16a34a')).toEqual({ ok: true, value: 'tint:#16a34a' });
    expect(validateVarValue(spec, 'tint:bogus').ok).toBe(false);
  });
});

describe('spliceHtmlVars', () => {
  const theme = { background: '#ffffff', accent: '#3b82f6' };

  it('returns html unchanged with no manifest', () => {
    expect(spliceHtmlVars('<div>x</div>', undefined, theme)).toEqual({ html: '<div>x</div>', rootCss: '' });
  });

  it('emits :root custom props and replaces {{tokens}}', () => {
    const html = `${manifest({
      value: { type: 'float', default: 62, min: 0, max: 100 },
      unit: { type: 'string', default: '%' },
    })}<div class="r">{{value}}{{unit}}</div>`;
    const out = spliceHtmlVars(html, { value: 80 }, theme);
    expect(out.rootCss).toContain('--value:80;');
    expect(out.rootCss).toContain('--unit:"%";');
    expect(out.html).toContain('<div class="r">80%</div>');
    expect(out.html).not.toContain('<script');        // manifest stripped
    expect(out.html).not.toContain('{{value}}');
  });

  it('resolves a tint color to a real theme color for both sides', () => {
    const html = `${manifest({ fill: { type: 'color', default: 'tint:accent' } })}<b>{{fill}}</b>`;
    const out = spliceHtmlVars(html, undefined, theme);
    // A light-theme accent tint is a pale wash — a real hex, not the raw token.
    expect(out.rootCss).toMatch(/--fill:#[0-9a-f]{6};/i);
    expect(out.rootCss).not.toContain('tint:');
    expect(out.html).toMatch(/<b>#[0-9a-f]{6}<\/b>/i);
  });

  it('HTML-escapes token values', () => {
    const html = `${manifest({ t: { type: 'string', default: '' } })}<p>{{t}}</p>`;
    const out = spliceHtmlVars(html, { t: '<img src=x>' }, theme);
    expect(out.html).toContain('<p>&lt;img src=x&gt;</p>');
  });

  it('does NOT re-substitute a value that contains another token (single pass)', () => {
    const html = `${manifest({
      a: { type: 'string', default: '{{b}}' },
      b: { type: 'string', default: 'X' },
    })}<p>{{a}}</p>`;
    const out = spliceHtmlVars(html, undefined, theme);
    expect(out.html).toContain('<p>{{b}}</p>'); // literal, NOT cascaded to X
  });

  it('leaves an unknown {{token}} untouched', () => {
    const html = `${manifest({ a: { type: 'string', default: 'A' } })}<p>{{a}} {{unknown}}</p>`;
    expect(spliceHtmlVars(html, undefined, theme).html).toContain('<p>A {{unknown}}</p>');
  });

  it('parses AND strips every manifest when there are several', () => {
    const html = `${manifest({ a: { type: 'int', default: 1 } })}`
      + `<p>{{a}}-{{b}}</p>`
      + `${manifest({ b: { type: 'int', default: 2 } })}`;
    const out = spliceHtmlVars(html, { a: 7, b: 9 }, theme);
    expect(out.html).toContain('<p>7-9</p>');
    expect(out.html).not.toContain('eigendeck-vars+json'); // both manifests stripped
    expect(out.rootCss).toContain('--a:7;');
    expect(out.rootCss).toContain('--b:9;');
  });

  it('omits an out-of-range number decl by falling back to the default', () => {
    const html = manifest({ v: { type: 'int', default: 5, min: 0, max: 10 } });
    expect(spliceHtmlVars(html, { v: 999 }, theme).rootCss).toContain('--v:5;');
  });
});

describe('resolveColorVar', () => {
  it('passes literals through and resolves tints via theme', () => {
    const theme = { background: '#ffffff', accent: '#3b82f6' };
    expect(resolveColorVar('#e11d48', theme)).toBe('#e11d48');
    expect(resolveColorVar('tint:accent', theme)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('isValidColor', () => {
  it('accepts hex / rgb / named, rejects junk', () => {
    expect(isValidColor('#fff')).toBe(true);
    expect(isValidColor('#abcdef12')).toBe(true);
    expect(isValidColor('rgb(1,2,3)')).toBe(true);
    expect(isValidColor('hsl(200, 50%, 40%)')).toBe(true);
    expect(isValidColor('teal')).toBe(true);
    expect(isValidColor('#xyz')).toBe(false);
    expect(isValidColor(42)).toBe(false);
  });
});
