# Clipboard paste: how source apps ship data, how editors handle it, and where Eigendeck's gaps are

Reference for anyone working on the paste pipeline (`src/components/SlideEditor.tsx`
`handlePaste`, `src/lib/htmlPasteCapture.ts`, `src-tauri/src/pasteboard.rs`,
`src-tauri/src/clip.rs`). Compiled from a primary-source research pass (2026-07);
every non-obvious claim is cited. The recurring theme: **a clipboard is a
multi-flavor bag — one "copy" writes several representations at once, and the
question per source app is which flavor holds real bytes vs a mere reference (a
URL or a file path).**

## What Eigendeck does today (the 7-step chain)

The canvas paste handler (Cmd/Ctrl-V onto a slide) tries sources in fidelity order
and takes the first that yields a usable image:

1. **In-app internal clip** — our own copied element, restored full-fidelity into
   this deck (`App.tsx`; marker `<!--eigendeck-copy:v1-->` in `src/lib/clipboard.ts`).
2. **macOS NSPasteboard** (native Rust, `pasteboard_list_types`/`pasteboard_read_type`)
   — reads the *unfiltered* UTI list + bytes, prefers SVG > PDF > PNG > JPEG. Catches
   vendor UTIs (`com.microsoft.image-svg-xml`, `com.adobe.pdf`, `public.svg-image`)
   that WebKit's web clipboard APIs drop.
3. **Sync `clipboardData.items`** — best of SVG/PDF/PNG/JPEG/GIF/WebP by MIME/UTI alias.
4. **Async `navigator.clipboard.read()`** — only for vector (SVG/PDF) the sync API missed.
5. **Embedded data-URL `<img>` in `text/html`** — Google Slides' shape (`extractPastedDataUrlImage`, #158).
6. **Rich-HTML → screenshot** — tables / formatted blocks rendered in the deck font
   and rasterized to PNG (`captureHtmlToPng` via modern-screenshot).
7. **Linux arboard read** — pull the raster straight off the X11/Wayland clipboard
   (`clip_read_system_image`, #94) when WebKitGTK doesn't surface a screenshot.

This matches how the mature editors are architected (own-format → vector → raster →
HTML → text). See the gaps section for what it misses.

## Source app → clipboard flavors → where the real data is

| Source app | Flavors on the clipboard | Where the real bytes are | Our handling |
|---|---|---|---|
| **Google Slides** (web) | `text/plain`; `text/html` (`<b id="docs-internal-guid-…">` wrapper); `application/x-vnd.google-docs-slide-clip+wrapped`. Usually **no standalone `image/png`**. | Image = `data:image/png;base64,…` **inside the `<img>` in `text/html`**. The `+wrapped` type is opaque Slides-internal JSON. | Step 5 (#158). |
| **Google Docs** (web) | `text/plain`; `text/html` (`docs-internal-guid`); `application/x-vnd.google-docs-document-slice-clip+wrapped` (double-encoded `{"data":"<json-string>"}`, Google-internal). | Rich text = `text/html`. Custom type not worth parsing. | Step 6 (screenshot) or → text element (future, #161). |
| **Google Sheets** (web) | `text/plain` **(TSV)**; `text/html` (`<table>` / `<google-sheets-html-origin>`, with `data-sheets-value`/`data-sheets-formula` per cell); `…-spreadsheet-slice-clip+wrapped`. | Values → TSV; formatting+typed values → HTML table attrs. | Step 6 (screenshot). |
| **MS Word/PowerPoint/Excel** (Windows) | `"HTML Format"` (CF_HTML), `"Rich Text Format"`, `CF_DIB`/`CF_DIBV5`/`"PNG"`, `CF_ENHMETAFILE`, native `"Art::GVML ClipFormat"`, OLE. Marker `<meta name=Generator content="Microsoft Word …">` + `xmlns:o=` / `mso-*`. | Bitmap → `"PNG"`/`CF_DIB`; native shape → GVML (Office-only) w/ metafile fallback; rich text → RTF / CF_HTML fragment. | (Windows) sync PNG or step 6. |
| **MS Office** (macOS) | `public.html`, `public.rtf`, `public.png`, `public.tiff`, `com.adobe.pdf`; Office-private `com.microsoft.Art--GVML-ClipFormat`, `com.microsoft.image-svg-xml`, etc. | Cross-app = `com.adobe.pdf` (vector) or `public.tiff`/`png`. `com.microsoft.*` are Office-only. | Step 2 (native, SVG>PDF>PNG). |
| **Apple Keynote/Pages/Numbers** | `com.apple.iWork.TSP*` (opaque, iWork-only); fallbacks `com.adobe.pdf`, `public.tiff`, `public.png`; **text adds `public.rtf` + `public.utf8-plain-text`, often NO `text/html`**. | Non-iWork apps → PDF/TIFF/PNG. | Step 2 for images. **Text-only → nothing today → G4/#161.** |
| **Adobe Illustrator** (macOS) | `com.adobe.pdf`; AICB (`CorePasteboardFlavorType 0x41494342`); EPS `com.adobe.encapsulated-postscript`; `public.tiff`. | Editable vector = PDF/AICB/EPS; TIFF is a raster preview. | Step 2 (PDF/SVG). |
| **Adobe Acrobat / Preview** (macOS) | Region copy → `public.tiff` (+ often `public.png`), `com.adobe.pdf` when a vector render exists. | PDF when present, else TIFF/PNG. Partial-region copies often degrade to TIFF-only. | Step 2. |
| **Web browser — "Copy Image"** | **`image/png`** (real bytes) **and** `text/html` with `<img src="https://REMOTE-url">` (a URL, not `data:`). "Copy Image Address" → URL as `text/plain` only. | Pixels in `image/png`. HTML `<img>` needs a network fetch. | Steps 3–4 catch the PNG. **HTML-only remote-`<img>` → G2 (declined).** |
| **Screenshot tools** | macOS → `public.tiff` (often `public.png`); Windows → `CF_DIB`/`CF_BITMAP`; Linux → **`image/png`** on X11/Wayland. | The bitmap; no HTML/URL. | macOS native/sync; **Linux → step 7 (arboard).** |
| **File manager — copy a FILE** | Linux: `text/uri-list` (`file://…`) + `x-special/gnome-copied-files` (`copy\n…`); macOS: `public.file-url` / `NSFilenamesPboardType`; Windows: `CF_HDROP` (DROPFILES → double-null path array). | **Paths/URIs, not bytes.** | **Not handled → G1/#160 (highest-impact miss).** |
| **Figma** (regular Cmd+C) | `text/plain` + `text/html` with empty spans carrying `data-metadata="<!--(figmeta)…-->"` / `data-buffer="<!--(figma)…-->"` (base64 Kiwi binary). **No `image/png`, no `<img>`.** | Design bytes in the base64 buffer (Figma-only). | Nothing pasteable; guidance = "Copy as PNG". |

## How the mature editors order and handle paste

The near-universal chain is **own-format → text/html → image/files → text/plain
(→ text/uri-list)**. The own-format is either a private MIME type or a data-attribute
smuggled into `text/html`; editors never trust a `text/html` round-trip for internal
fidelity.

- **ProseMirror / TipTap** — `handlePaste`/`transformPastedHTML`/`transformPasted` +
  `clipboardParser`. Lossless internal paste rides **inside `text/html`** via a
  `data-pm-slice="openStart openEnd … <json context>"` attribute (parsed back with
  `/^(\d+) (\d+)(?: -(\d+))? (.*)/`). Cruft handling is light in core (strips leading
  `<meta>`, undoes WebKit nbsp spans); deep Word/GDocs scrubbing is userland. Images
  are a separate axis via `handlePaste`/`handleDrop` reading `clipboardData.files`.
  This is the same "hide your format inside the HTML" trick Eigendeck uses.
- **Lexical (Meta)** — `$insertDataTransferForRichText` tries strict priority
  **`application/x-lexical-editor` → `text/html` → `text/plain` → `text/uri-list`**.
  Notably handles `text/uri-list` as a first-class type (we don't). Strict CSP can
  silently drop the custom type.
- **Slate** — `withReact` writes `text/plain` + `text/html` + private
  `application/x-slate-fragment` (base64 Slate JSON); `editor.insertData` checks the
  fragment first, then HTML, then text.
- **Excalidraw** (canvas) — reads via `navigator.clipboard.read()` first; writes/detects
  `application/vnd.excalidraw.clipboard+json` (also duplicated into `text/plain`); paste
  order own-JSON → `text/html` → text → image files. Same philosophy as us.
- **tldraw** (canvas) — embeds a versioned `{type:'application/tldraw',version:3,…}`
  snapshot **inside `text/html`** as `<div data-tldraw>…</div>` (Figma-style), with
  image/text fallbacks; its *only* genuine "web " custom format is
  `web image/vnd.tldraw+png` (to preserve a 2× PNG chunk browsers strip). Paste order:
  files → tldraw div → **Excalidraw JSON (interop!)** → HTML → URL → text. Keeps the
  copy write synchronous so WebKit honors the user gesture.
- **CKEditor 5** — a dedicated paste-from-office plugin detects Word by
  `/<meta … content="microsoft word …/i` + `xmlns:o=`, Google Docs by
  `/id=("|')docs-internal-guid-[-0-9a-f]+/i`, then normalizes the HTML through
  `clipboardInput → inputTransformation → contentInsertion`.
- **TinyMCE** — core paste cleanup; `paste_data_images` toggles keeping base64 `data:`
  images; commercial PowerPaste does source-aware Word/GDocs cleaning.

### Web Custom Formats (`"web "`-prefixed `ClipboardItem` types)
Prepend `"web "` (+ U+0020 space) to a MIME type for **unsanitized, byte-identical**
app data. **Chromium-only since v104 (Aug 2022); NOT in Safari/WebKit or Firefox.**
Maps to the native clipboard via `org.w3.web-custom-format.map` →
`org.w3.web-custom-format.type-N`. **Implication for us: on WebKitGTK these are
unavailable — the `<!--eigendeck-copy:v1-->` HTML-comment marker is the correct
cross-WebKit choice; do NOT "upgrade" to `ClipboardItem("web application/eigendeck")`,
it would break lossless self-paste on the shipped WebKit.**

### Async vs sync
Sync `event.clipboardData` (copy/paste events) exposes/accepts arbitrary MIME types
with no sanitization, but only inside a trusted user gesture and it's neutered after
any `await`. Async `navigator.clipboard.read()/write()` needs transient activation +
secure context and exposes only sanitized standard types (`text/plain`, `text/html`,
`image/png`) unless you opt a type out with `read({unsanitized:[…]})` (Chromium).
This is *why* we need the native NSPasteboard path to see vendor UTIs, and why the
copy write must stay synchronous relative to the gesture for WebKit.

### Windows CF_HTML header
`"HTML Format"` is always UTF-8 and prefixes the markup with ASCII `Keyword:value`
lines: `Version` (0.9, now 1.0 since Win10 20H2), `StartHTML`, `EndHTML`,
`StartFragment`, `EndFragment`, optional `StartSelection`/`EndSelection`, optional
`SourceURL`. **Offsets are BYTE offsets from byte 0**, possibly zero-padded for
back-patching; the fragment is bracketed by `<!--StartFragment-->` / `<!--EndFragment-->`.
**Browsers (Chromium + WebKit) parse and strip the numeric header** — a page's
`getData('text/html')` gets the markup without `Version:…StartFragment:####`; the
`<!--StartFragment-->` comments may survive but are inert in our `DOMParser` capture.
So CF_HTML stripping is a non-issue even on Windows; detect Office via the
`<meta name=Generator content="Microsoft …">` tag, not the header. The native/editable
payloads (GVML, DIB, OLE) are not reachable from the DOM clipboard API anyway.

## Gaps in our chain (ranked) → issues

- **G1 — file paste is unhandled (HIGHEST).** Copying an image/SVG/PDF *file* in the
  file manager puts only a path (`public.file-url` / `text/uri-list` / `CF_HDROP`), no
  bytes; nothing in our chain reads it → silent no-op. → **#160 (release)**.
- **G2 — HTML-only remote `<img src="http…">` → blank capture.** Falls into step 6;
  modern-screenshot can't fetch the remote image (sandbox/offline) → blank/broken PNG.
  → **declined** (not filed).
- **G3 — only the FIRST `data:` `<img>` is extracted.** Multi-image Slides pastes drop
  the rest. → **#162 (low priority)**.
- **G4 — text-only / RTF-only paste onto the canvas → nothing.** Keynote/Pages text,
  browser text, plain `text/plain` all no-op. → **#161 (release)**: create a text
  element preserving toolbar-authorable style + color (via `sanitizeRichText`), no
  font-size.
- **G6 — CF_HTML header** — non-issue (browsers strip it); noted for completeness.

**Correctly handled (keep):** the `docs-internal-guid` data-URL extraction (step 5);
the `<!--eigendeck-copy:v1-->` HTML-comment marker for lossless self-paste (correct
for WebKit — not web custom formats); native-NSPasteboard-first ordering
(SVG>PDF>PNG>JPEG) matching own-format → vector → raster.

## Selected primary sources
- Alex Harri, "The web's clipboard, and how it stores data of different types" — https://alexharri.com/blog/clipboard
- MDN — ClipboardItem / Clipboard.read — https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
- Microsoft Learn — HTML Clipboard Format (CF_HTML) — https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format
- Microsoft Learn — Shell Clipboard Formats (CF_HDROP / DROPFILES) — https://learn.microsoft.com/en-us/windows/win32/shell/clipboard
- Apple — NSPasteboardTypeFileURL — https://developer.apple.com/documentation/appkit/nspasteboardtypefileurl
- GNOME nautilus — `x-special/gnome-copied-files` — https://gitlab.gnome.org/GNOME/nautilus/-/issues/634 ; wl-clipboard — https://github.com/bugaevc/wl-clipboard
- W3C Clipboard APIs (header stripping) — https://github.com/w3c/clipboard-apis/issues/193 ; Chromium behavior (Daniel Cheng) — https://lists.w3.org/Archives/Public/public-webapps/2015AprJun/0240.html
- Chrome for Developers — Web custom formats — https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api/
- Lexical clipboard source — https://github.com/facebook/lexical/blob/main/packages/lexical-clipboard/src/clipboard.ts
- ProseMirror clipboard source — https://github.com/ProseMirror/prosemirror-view/blob/master/src/clipboard.ts
- Excalidraw clipboard source — https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/clipboard.ts
- CKEditor paste-from-office — https://ckeditor.com/docs/ckeditor5/latest/features/pasting/paste-from-office.html
- Google Docs slice-clip envelope — https://www.npmjs.com/package/@atjson/source-gdocs-paste
- Chromium "Copy image copies the url" — https://issues.chromium.org/issues/41386571
