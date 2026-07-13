import { describe, it, expect } from 'vitest';
import {
  parseHtmlVars, validateVarValue, resolveVars, stripVarsManifest, isValidColor,
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
