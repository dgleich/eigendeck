# HTML element variables (proposed)

> **Status: proposed / pre-implementation.** A design to decide on before building.
> Applies to the `html` element (the sandboxed, script-less, offline escape hatch —
> see `docs/LLM-EDITING.md`). Not for demos (those have real JS).

## Motivation

Some `html` snippets are "begging for a variable": a thermometer you want to pin to
a level, a gauge you want to point at a value, a card whose accent color or label
you want to tweak — without editing the HTML each time. Today you edit the markup;
these want a typed knob in the inspector instead.

The `html` element runs with **no JavaScript**, so a "variable" is not a runtime JS
value — it's a value **spliced in at render time**. The insight (validated by
rendering a real CSS gauge) is that a variable needs **two splice targets**, because
a gauge needs both:

- **CSS** — to drive the *visual* (needle rotation, fill height, color). Handled by
  CSS custom properties: the author writes `var(--value)`, we inject `:root{--value:…}`.
- **HTML** — to appear as *real text* (the readout, min/max labels, a `<title>`,
  `aria-*`). CSS vars can't reach DOM text (only `content:` via a fragile integer-only
  `counter` hack), so we also splice `{{name}}` tokens into the HTML body.

**One declared variable → two targets.** The author reaches for whichever a spot
needs.

## The dual splice

| Target | Author writes | We do | Escaping |
|--------|---------------|-------|----------|
| CSS    | `var(--value)` | inject `:root{ --value: 62; }` into the srcdoc `<style>` | value sanitized to a safe CSS token by type |
| HTML   | `{{value}}`    | replace the token with the value in the HTML body | HTML-escaped (`& < > "`) |

A gauge then reads:
```html
<div class="needle" style="transform:rotate(calc(-90deg + var(--value)*1.8deg))"></div>
<div class="readout">{{value}}{{unit}}</div>        <!-- real text: "62.5°C" -->
<h3 class="title">{{label}}</h3>
```
Needle from the CSS var; readout/title from HTML tokens; same variables.

## Declaration (the manifest)

Variables are declared in a **JSON data island** in the snippet — a
`<script type="application/eigendeck-vars+json">` block (same non-executing pattern
as the demo manifest; the sandbox has no `allow-scripts`, so it never runs, and the
builder strips it from the rendered body):

```html
<script type="application/eigendeck-vars+json">
{
  "value": { "type": "float",  "default": 62, "min": 0, "max": 100, "step": 0.5,
             "label": "Value", "help": "Needle position", "width": 72 },
  "fill":  { "type": "color",  "default": "#e11d48" },
  "unit":  { "type": "string", "default": "%", "width": 48 }
}
</script>
```

- **`type`**: `"float"` | `"int"` | `"color"` | `"string"`.
- **`default`**: the value when the element hasn't overridden it (synthesised per
  type — `0` / `#000000` / `""` — if absent or invalid).
- **`min` / `max` / `step`**: numbers only; drive the inspector slider (optional).
- **`label`**: optional inspector display name (defaults to the key).
- **`help`**: optional explanation shown beneath the control in the inspector.
- **`width`**: optional inspector control width in px (defaults: 72 numeric/color, 150 string).
- **`multiline`** (`string` only): render a multi-line textarea instead of a single-line box.
- The var **key** is the name used everywhere: CSS `var(--value)`, HTML `{{value}}`.
  It must be a safe identifier (`[A-Za-z_][\w-]*`); malformed entries are dropped.

A pure parser `parseHtmlVars(html): VarSpec[]` (plus `validateVarValue`,
`resolveVars`, `stripVarsManifest`) lives in `src/lib/htmlVars.mjs` and is shared by
the inspector and the render builder (no duplicated parsing). **Implemented.**

## Data model

```ts
interface HtmlElement {
  // …existing: html, background, interactive, scaleMode/scaleW/scaleH…
  /** Per-variable VALUES (overrides of the manifest defaults). Keyed by var name.
   *  The DECLARATION (types/defaults/ranges) lives in the html manifest, not here. */
  vars?: Record<string, string | number>;
}
```

The manifest is author-owned (in `html`); `vars` is the small set of current values.
Resolved value = `element.vars[name] ?? manifest[name].default`.

## Rendering

All splicing happens in the **one shared builder** (`src/lib/htmlElement.mjs`
`htmlElementSrcdoc`, via `spliceHtmlVars` in `htmlVars.mjs`), so every render path
(editor, present, thumbnail, HTML export, PDF/print) gets it for free — no #98-class
drift. Each path passes the element's `vars` + the resolved slide `theme`. Steps:

1. `parseHtmlVars(html)` → declared vars; strip the manifest `<script>` from the body.
2. Resolve values (defaults ⊕ `element.vars`); resolve color tints against the theme.
3. **CSS**: emit `:root{ --k: <cssValue>; … }` into the injected `<style>` (after the
   CSP/print-color-adjust rules). `cssValue` is type-sanitized (below).
4. **HTML**: replace each `{{k}}` in the body with the HTML-escaped value.

**Implemented** — verified end-to-end (real builder → headless render) across
literal/tint colors and multiple themes. Example: `examples-html-elements/gauge.html`.

## Types, escaping, safety

The element is already sandboxed (no script, no network), so the worst case is an
author breaking *their own* element's look — no security exposure. Still, sanitize
per context so a value can't break out of the `<style>` or the markup:

| type | CSS value (`--k`) | HTML token (`{{k}}`) |
|------|-------------------|----------------------|
| `int` / `float` | numeric only (`^-?\d+(\.\d+)?$`, else default) | the number, HTML-escaped (no-op) |
| `color` | validated CSS color (hex / `rgb()` / `hsl()` / named; else default) | the color string, escaped |
| `string` | a CSS string: double-quoted, `"`/`\`/newlines escaped, `}`/`<` stripped | HTML-escaped (`& < > "`) |

No expression evaluation. `{{value}}` and `var(--value)` are **literal** substitutions
— math lives in the author's `calc()`.

## Inspector

`PropertiesPanel` html block gains a **Variables** section (`HtmlVariablesSection`),
shown only when the manifest declares any. One compact typed control per variable,
each `spec.width` wide:
- `float` / `int` → text box + a slider when `min`/`max` are given (respecting `step`).
- `color` → the full `ColorControl` (palette swatches + custom picker + **theme
  tints**), like the element Background control.
- `string` → text box, or a multi-line textarea when `multiline` is set.

### Color values: literal or theme tint

A `color` value is stored as either a **literal** CSS color (`#e11d48`, `red`) or a
**tint token** `tint:<base>`, where `<base>` is `accent` (follows the slide theme) or
a semantic hex (`tint:#dc2626`). A tint is theme-relative: it stores the *base*, and
the real color is resolved **per slide theme** at render time via the same
`textBackgroundResolved` used for card backgrounds (a wash on light themes, a
saturated mix on dark) — so one variable stays colored and contrasting on every
theme. Literals pass through unchanged. The token keeps `vars` flat (still a string);
`tint:accent` is a perfectly valid `default`.

A value that fails validation flags a red **✕** next to the control and is **not
written** to the store (the last valid value stands). Each valid edit writes
`element.vars[name]`; a value equal to the default drops the key (keeps `vars`
small). Author `help` renders beneath the control. This is a **non-interactive**
parametrization (values set in the inspector), complementary to the `interactive`
flag (in-frame native controls) — a gauge needs neither script nor `interactive`.
**Implemented** (render splice below is the remaining piece).

## Non-goals (the guardrail)

Keep it **flat typed values**. No conditionals, no `{{value * 2}}` expressions, no
loops, no per-cell logic. The moment a snippet needs logic it's a **demo**, not an
`html` element. This line is what keeps the feature small and safe.

## Future (why the CSS-var side matters)

A CSS custom property can be **transitioned/animated by the browser**, so a variable
is a natural hook for a **linked / animated value** — a thermometer or gauge riding a
build (level 20 → 80 across a reveal) with **zero JS**, via the linked-objects
machinery. A spliced `{{token}}` alone would need a re-render per frame; the CSS var
animates natively. Shared variables across multiple html elements on a slide is a
possible later extension. Shaping the data model as `vars` now keeps that open.

## Open decisions

- **Manifest vs inspector-authoring:** author the JSON island by hand (this spec), or
  let the inspector "Add variable" write/maintain the island for you?
- **String reach:** ship `string` in v1 (HTML token + CSS string), or start
  float/int/color only and add string once there's a real case?
- **Reset semantics / validation UX** when a stored value falls outside a later-edited
  `min`/`max`.
- **Scale-mode + a size-affecting variable** (known, minor): `scaleMode` captures the
  content's natural `scaleW`/`scaleH` **once** and doesn't re-measure when a variable
  later changes the content's size, so the contain-fit is computed against a stale
  design size until scale mode is toggled off/on. Treated as by-design (the design size
  is a deliberate snapshot); revisit only if it bites in practice.
