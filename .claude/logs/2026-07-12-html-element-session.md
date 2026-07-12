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
