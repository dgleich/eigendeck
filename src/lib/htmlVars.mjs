// HTML-element variables (#138) — the ONE place the `html` element's typed
// variables are declared, parsed and validated. Shared by the inspector (typed
// controls) and, later, the render builder (splice), so the two never drift.
//
// A snippet declares variables in a JSON data-island:
//   <script type="application/eigendeck-vars+json">
//     { "value": { "type":"float", "default":62, "min":0, "max":100, "step":0.5,
//                  "label":"Value", "help":"Needle position", "width":72 } }
//   </script>
// The element stores the current VALUES in `el.vars` (a name→value map); the
// DECLARATION (types/defaults/ranges/help) lives here in the html. There is NO
// logic — a variable is a flat typed value spliced in two ways (CSS var + {{token}}).
//
// The manifest <script> never executes (the sandbox has no allow-scripts) and is
// stripped from the rendered body by stripVarsManifest().

/** The data-island script type carrying the variable manifest. */
export const VARS_SCRIPT_TYPE = 'application/eigendeck-vars+json';

/** The four variable types. */
export const VAR_TYPES = ['float', 'int', 'color', 'string'];

// Match the manifest <script> block (type in either quote style, any attr order).
const MANIFEST_RE =
  /<script\b[^>]*\btype\s*=\s*["']application\/eigendeck-vars\+json["'][^>]*>([\s\S]*?)<\/script\s*>/i;

// A var NAME must be a safe identifier: it becomes a CSS custom prop (`--name`)
// and an HTML token (`{{name}}`), so restrict to letters/digits/_/- (no leading digit).
const NAME_RE = /^[A-Za-z_][\w-]*$/;

// Pragmatic CSS-color check for the `color` type: hex (3/4/6/8), rgb()/rgba()/
// hsl()/hsla(), or a common named color. Lenient enough for authoring, strict
// enough to reject garbage that would break the injected `:root{--k:…}`.
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/deg]+\)$/i;
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue',
  'yellow', 'orange', 'purple', 'pink', 'gray', 'grey', 'brown', 'cyan',
  'magenta', 'lime', 'teal', 'navy', 'maroon', 'olive', 'silver', 'gold',
  'indigo', 'violet', 'coral', 'salmon', 'crimson', 'tomato', 'khaki',
]);

/** Is `v` a valid CSS color for the `color` type? */
export function isValidColor(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return HEX_RE.test(s) || FUNC_COLOR_RE.test(s) || NAMED_COLORS.has(s.toLowerCase());
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse the variable manifest out of `html` → an ORDERED list of specs.
 *  Malformed entries (bad name/type) are dropped; a missing/unparseable
 *  manifest yields []. Never throws. */
export function parseHtmlVars(html) {
  if (typeof html !== 'string' || html.indexOf(VARS_SCRIPT_TYPE) === -1) return [];
  const m = MANIFEST_RE.exec(html);
  if (!m) return [];
  let obj;
  try {
    obj = JSON.parse(m[1].trim());
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];

  const specs = [];
  for (const [name, raw] of Object.entries(obj)) {
    if (!NAME_RE.test(name) || !raw || typeof raw !== 'object') continue;
    const type = VAR_TYPES.includes(raw.type) ? raw.type : null;
    if (!type) continue;

    const spec = { name, type };
    // Default (synthesised per-type when absent/invalid so a control always has a value).
    if (type === 'int' || type === 'float') {
      let d = num(raw.default);
      if (d === undefined) d = 0;
      spec.default = type === 'int' ? Math.round(d) : d;
      const mn = num(raw.min); if (mn !== undefined) spec.min = mn;
      const mx = num(raw.max); if (mx !== undefined) spec.max = mx;
      const st = num(raw.step); if (st !== undefined && st > 0) spec.step = st;
    } else if (type === 'color') {
      spec.default = isValidColor(raw.default) ? String(raw.default).trim() : '#000000';
    } else {
      spec.default = raw.default == null ? '' : String(raw.default);
    }

    if (typeof raw.label === 'string' && raw.label.trim()) spec.label = raw.label.trim();
    if (typeof raw.help === 'string' && raw.help.trim()) spec.help = raw.help.trim();
    const w = num(raw.width); if (w !== undefined && w > 0) spec.width = Math.round(w);
    specs.push(spec);
  }
  return specs;
}

/** Validate a raw value against a spec. Returns `{ ok, value }` where `value` is
 *  the coerced value when ok (number for int/float, trimmed string otherwise).
 *  Used for the inspector's red-✕ flag and (later) render-time coercion. */
export function validateVarValue(spec, raw) {
  if (spec.type === 'int' || spec.type === 'float') {
    const s = typeof raw === 'string' ? raw.trim() : raw;
    if (s === '' || s == null) return { ok: false };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false };
    if (spec.type === 'int' && !Number.isInteger(n)) return { ok: false };
    if (spec.min !== undefined && n < spec.min) return { ok: false };
    if (spec.max !== undefined && n > spec.max) return { ok: false };
    return { ok: true, value: n };
  }
  if (spec.type === 'color') {
    return isValidColor(raw) ? { ok: true, value: String(raw).trim() } : { ok: false };
  }
  // string — any value is valid.
  return { ok: true, value: raw == null ? '' : String(raw) };
}

/** Resolve a specs list against stored `vars` → a name→value map, falling back to
 *  each spec's default when the stored value is missing or invalid. */
export function resolveVars(specs, vars) {
  const out = {};
  for (const spec of specs) {
    const stored = vars ? vars[spec.name] : undefined;
    if (stored == null) { out[spec.name] = spec.default; continue; }
    const v = validateVarValue(spec, stored);
    out[spec.name] = v.ok ? v.value : spec.default;
  }
  return out;
}

/** Remove the manifest <script> from the html (it's metadata, never rendered). */
export function stripVarsManifest(html) {
  return typeof html === 'string' ? html.replace(MANIFEST_RE, '') : html;
}
