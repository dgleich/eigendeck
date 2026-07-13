# Raw-HTML element (#137)

Branch: `feat/html-element` (off `feat/arrow-splines`).

An LLM escape hatch: a general `html` element for arbitrary design/layout markup —
not the text element, not a demo.

## Design decisions (with the user)
- **No script, no network** (data: URIs only) — enforced by the browser, not a
  sanitizer.
- **Plain `html` field** on the element (rides undo/redo), not an asset.
- **Both editing modes**: in-canvas best-effort contentEditable + Inspector textarea.

## How the safety works
Renders raw HTML in a sandboxed `srcdoc` iframe:
- **No `allow-scripts`** → zero JS (inline handlers can't fire; the frame can't drop
  its own sandbox). The whole no-script guarantee.
- Injected CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`
  → no network, data: URIs only.
- The **editor** uses `allow-same-origin` (still script-less — the safe combination)
  so the parent can toggle `contentEditable` on the framed body and read the markup
  back. Every other path uses the fully-locked empty sandbox.

No sanitizer needed — the markup can "go wild" and the browser contains it.

## Shape
- `src/lib/htmlElement.mjs` — the ONE place the sandbox + CSP live (srcdoc builder +
  constants), shared by every path so isolation can't drift. + `.d.mts` + unit test.
- All 7 render paths (editor / present / present-wrapper=noop / HTML export / PDF-print
  inline / link-overlay placeholder / thumbnail). Print needs no bake — a static
  srcdoc iframe renders in the browser's print output. **Confirmed working on the Mac
  (user, 2026-07-12)** — the print/PDF path was the one thing not headlessly verifiable.
- Insert: native **Insert → HTML Element** menu only (no toolbar button). Inspector:
  raw-HTML textarea + Background + a "may reshape complex markup" warning.
- Docs: LLM-EDITING.md (authoring reference), SPEC.md, AGENTS.md element list.

## Verification
- tsc + cargo + `npm run build` clean; full vitest 1142 green.
- Per-path tests assert the sandbox/CSP in each render target (the #98 drift class).
- e2e (`html-element-probe.mjs`, gated): HTML_PASS — editor same-origin iframe renders
  the authored markup (read via contentDocument), CSP present, no allow-scripts,
  double-click → contentEditable, export locked. Screenshots confirmed gradient-clipped
  design HTML + the edit-mode warning banner.

Not pushed; branch is local (part of the arrow-splines → html-element stack the user
will collapse).

---

## Continuation (2026-07-12→13): interactivity, files, a snippet library, print fixes

The escape-hatch element grew a bunch of affordances once it proved out.

### Opt-in interactivity (`30bf050`)
- New `interactive?: boolean`. When set, the sandboxed frame receives pointer
  events (native `:hover`, CSS `:checked` radios/checkboxes) — **still no script**.
  Drove a **CSS-only thermometer** whose level is set by `:checked` radios.
- Editor still needs a way to drag vs interact: double-click enters "interacting"
  (frame gets events); click-away / Esc exits. The **"Lock" button was dropped**
  (`f4fdda7`) — the user found it wrong for html; exit is implicit now. The edit
  warning moved to **below** the element (`4dccf8a`).

### Insert-from-file + a committed snippet library
- **Insert → HTML Element from File…** (`29956de`) picks a snippet and
  **validates** it (`htmlSnippet.ts`, pure/dependency-free for a future online
  repo): rejects empty / non-HTML / `<script` / inline `on*=` handlers / remote
  resources (http(s)/protocol-relative in src/srcset/url()/@import/link). Interactive
  snippets are auto-detected.
- **`examples-html-elements/`** (`545675e`) — the snippet library, moved **out of
  gitignore** at the user's insistence (**"putting working, useful code in
  gitignore isn't very helpful"**; render artifacts may stay gitignored, code may
  not). Each `.html` starts `<!-- eigendeck-html-element name="X" [interactive] -->`;
  a gallery deck is built from them. `schema_compat.rs` now globs this dir too.

### Print/PDF was actually broken (the user was right to be mad)
- The checklist covered the print path *structurally*, but the real PDF stripped
  html-element backgrounds/gradients: `print-color-adjust:exact` **doesn't cascade
  into a sandboxed iframe**. Fix = set it inside the srcdoc html/body
  (`4571533`). The **same bug bit notebook export** (`c69b2d8`). Root-caused and
  re-verified in a real headless-Chromium PDF (thermometer prints fully).
- Also fixed **config-less present** rendering blank (`716b096`, default
  1920×1080) — surfaced while dogfooding.

### Dogfooding: frontend-slides
- Researched the popular `frontend-slides` Claude skill and built a
  **`frontend-slides-eigendeck` skill** (`b962674`) + a 6-slide bold example deck
  (`fd59dee`) showing how far the html element gets you toward designer slides.
- A 12-slide **html-showcase** deck (`f57887c`, by a background agent).

### Menu/doc housekeeping (same session)
- Insert menu gained **"Card"** (`3e25ab9`, was toolbar-only); View menu gained
  **"Customize Toolbar…"** → Settings "UI & Toolbar" (`3019e32`, via
  `openSettingsWindow(tab)` deep-linking).
- **`docs/ELEMENT-CHECKLIST.md`** (`62e479e`) — the "what to touch across the 7
  render/output modes" checklist, so the #98/#85 drift class is a lookup.

### Verification
- Broad e2e suite (8 gated probes): render/persist/edit/undo, security
  (no-script + no-egress in real WebKit), interactive thermometer, present-stage,
  thumbnail, duplicate/delete. Undo/redo confirmed captured for **both** edit UIs.
- Still local, unpushed.

## Queued (not yet done)
- Jupyter toolbar button → Settings **"Jupyter servers"** tab (`openSettingsWindow('servers')`).
- Toolbar shrink: make **gaps between elements** shrink before hiding items off-right.
- HTML **scale-mode** inspector checkbox (never implemented — needs data model + all paths).
- Right-click context menu on every element type (issue #136).
