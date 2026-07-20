# Clipboard interop corpus

`corpus.json` records **what real apps put on the OS clipboard** and **which
Eigendeck paste branch** each payload must take. It backs
`src/lib/clipboardInterop.test.ts` (a vitest unit) and the interop reference
table in `docs/copy-and-paste.md`.

## What's real vs. representative

- **`flavors`** — the actual macOS pasteboard type lists, captured this session
  via **Debug → Dump Pasteboard Types** (dev builds only; see
  `src-tauri/src/debug.rs`). These are ground truth.
- **`html` / `plain`** — *representative* of each app's markup (the exact bytes
  vary per selection). They are shaped to exercise the classifier, not
  byte-for-byte captures.

## The four paste branches (`expect`)

| value | meaning | leaf function |
| --- | --- | --- |
| `internal` | Eigendeck private flavor (`data-eigendeck-copy` + JSON) | `decodeClipHtml` |
| `image-dataurl` | no clipboard image, but `text/html` embeds `<img src=data:…>` (#158) | `extractPastedDataUrlImage` |
| `image-screenshot` | block HTML a text box can't hold (table/img/svg/pre/math) | `htmlNeedsScreenshot` |
| `text` | styled/plain runs the format toolbar can author | `pasteTextToElementHtml` |

The ladder is tried in that order (first match wins) — mirrored by `classify()`
in the test, which must stay in sync with `SlideEditor.handlePaste`.

## Adding a real capture

1. In a **dev build**, copy from the app of interest, then Debug → Dump
   Pasteboard Types. The dump prints the flavor list to stdout + the JS console.
2. Add an object to `corpus.cases` with the real `flavors`, a representative
   `html`/`plain` for that selection, and the `expect` branch it should take.
3. `npx vitest run src/lib/clipboardInterop.test.ts` — a wrong `expect` (or a
   ladder regression) fails loudly.

Prefer adding the app you actually hit a bug with — the corpus grows by real
interop pain, not speculation.
