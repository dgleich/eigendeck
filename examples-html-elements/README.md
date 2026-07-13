# HTML element snippets

Self-contained **HTML snippets** for Eigendeck's raw-HTML element (#137). Each
`.html` file here is a *fragment* — a `<style>` + markup that drops straight into
an `html` element's `html` field (Eigendeck wraps it in the sandboxed document
shell with the CSP). They are the reusable, "download-and-add" cousins of a full
example deck.

**Constraints every snippet respects** (the element's sandbox):

- **No `<script>`** — motion is CSS `@keyframes` / `@property`; interactivity is
  native controls (`:checked`, `:hover`, `<details>`, `<input type=range>`).
- **No network** — no remote fonts/images/CSS. System font stacks; inline SVG or
  `data:` URIs for media.

Each file starts with a metadata comment:

```html
<!-- eigendeck-html-element name="Thermometer" interactive -->
```

`interactive` means the element needs `"interactive": true` (it responds to clicks
/ hover — set the checkbox in the Inspector, or the field in the JSON).

## Using a snippet

- **In the GUI:** insert an HTML Element (Insert menu), then paste the file's
  contents into the Inspector's Raw HTML box. Tick **Interactive** if the comment
  says so.
- **Programmatically:** put the file's contents in the element's `html` field:
  ```json
  { "type": "html", "interactive": true,
    "position": { "x": 660, "y": 300, "width": 600, "height": 480 },
    "html": "<style>…</style>…" }
  ```

## Snippets

| File | What it does | Interactive |
|------|--------------|:-----------:|
| `thermometer.html` | Radio/`:checked` thermometer — click a level, mercury animates | ✔ |
| `letter-reveal.html` | A word whose letters drop in + fade, staggered (the no-script cousin of the `gimmicks` demo) | |
| `typewriter.html` | Line typed out with a blinking caret (`steps()`) | |
| `shimmer.html` | Moving sheen swept across a word (`background-clip:text`) | |
| `progress-ring.html` | A conic-gradient ring that sweeps up to its target (`@property`) | |
| `gauge.html` | Semicircular gauge driven by **variables** (needle/arc/readout) — no script | |

**Variables (#138).** A snippet can declare typed variables in an
`application/eigendeck-vars+json` data-island; they splice in as `var(--name)` (CSS)
and `{{name}}` (text) and are edited in the Inspector's Variables section. `gauge.html`
is the worked example. See `docs/html-element-variables.md`.

See `docs/LLM-EDITING.md` (HTML Element) and the `frontend-slides-eigendeck` skill
for authoring guidance.
