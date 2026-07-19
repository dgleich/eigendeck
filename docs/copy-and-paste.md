# Copy & Paste — design

> Canonical design for Eigendeck's clipboard model. Written after a string of
> copy/paste desync bugs traced to a single root cause: **two clipboards that
> fall out of sync.** This doc defines the target model (one clipboard, many
> representations, private flavor read first) and the paste/styling rules.

## Motivation — the bug class

Eigendeck historically kept an **App-local in-memory buffer** (`clipboardRef`)
holding a copied element/slide, *separate* from the OS clipboard. The two paste
handlers (App's element/slide paste, SlideEditor's system-clipboard paste)
couldn't see the same state, and the buffer was never invalidated when the OS
clipboard changed. That produced a family of bugs, all the same disease:

- **Stale canvas paste.** Edit a text box, copy *part* of the text (writes the
  system clipboard, not the buffer) → paste on the canvas → the buffer serves
  the *old* element/slide you copied earlier.
- **Nothing pastes.** After we cleared the buffer on an edit-mode copy, a canvas
  paste produced *nothing*, because the system-clipboard handler deferred on our
  marker and never built the text box.
- **Accidental slide duplicate.** A lingering `slide` copy in the buffer makes
  ⌘V duplicate the current slide.
- **Black text.** Pasted text keeps a `color: black` (a source-app default or
  WebKit's neutral-context baked color), invisible on a dark slide.

## Principles (how mature editors do it)

Researched across Keynote, PowerPoint, Google Slides, Figma, Illustrator/InDesign:

1. **One clipboard, many representations, private flavor first.** No mature editor
   keeps a separate authoritative in-memory buffer. They write *everything* onto
   the OS clipboard — a **private high-fidelity flavor** plus standard
   interchange fallbacks (`text/html`, `text/plain`, image) — and read the
   private flavor *first* on paste. Because the OS clipboard is atomic (any copy
   overwrites it), there is nothing to desync.
   - Figma embeds its node tree as base64 inside `text/html` comments
     (`<!--(figma)…-->`); PowerPoint registers private clipboard formats
     (`Art::GVML ClipFormat`, `PowerPoint 12.0 Internal Slides`); Illustrator
     uses AICB + PDF flavors; Google Docs uses
     `application/x-vnd.google-docs-*`.
   - Any cache is *advisory only*, validated against the OS change counter
     (`NSPasteboard.changeCount` / `GetClipboardSequenceNumber`) and re-read on
     any increment. **Prefer holding nothing** — read live from the clipboard on
     paste.
2. **Paste target is decided by cursor/modal state, not clipboard contents.** A
   live text caret (editing a text box) → insert inline. Otherwise (canvas /
   selection mode) → create a new object. Copying *part* of a text box then
   pasting on the canvas makes a **new text box** with those characters.
3. **Default paste keeps source formatting; a separate command matches the
   destination.** "Black text invisible on a dark slide" is a *documented*
   failure mode; the fix everyone ships is "Paste and Match Style" / "Use
   Destination Theme."
4. **Duplicate is its own command that never touches the clipboard** (⌘D). Slide
   vs object paste is gated on *pane focus + a private slide flavor*, not a
   clipboard branch — which is why nobody gets an accidental slide duplicate.

## The Eigendeck model

### One source of truth: the OS clipboard

**Retire `clipboardRef`.** On every copy, write to the system clipboard in one
operation:

- **Private Eigendeck flavor** — the copied element(s)/slide as JSON, base64,
  embedded in the `text/html` payload behind our existing marker
  (`data-eigendeck-copy` — extend it from a bare marker to a carrier:
  `<div data-eigendeck-copy="v2" data-eigendeck-json="<base64>">…</div>`). This
  is the high-fidelity flavor and is read **first** on paste. (WebKit/Tauri has
  no web-custom-format support yet, so we ride inside `text/html` like Figma. If
  we later route copy through Rust `NSPasteboard`, promote this to a real custom
  UTI so it stops leaking into plain-text editors.)
- **`text/html`** — the visible, sanitizer-allowlisted markup (for pasting into
  other apps and as the styled fallback).
- **`text/plain`** — the text, for plain destinations.
- **image** (asset-bearing elements only) — a raster/vector rendering for
  external apps.

On paste we **read live from the clipboard**, private flavor first. No separate
buffer to invalidate ⇒ the stale-paste / nothing-pastes / accidental-duplicate
bugs cannot occur by construction.

### Internal references (links, sync groups)

An Eigendeck element may be **linked** across slides (shared `linkId`, for
animations) or in a **sync group** (shared content). The private JSON captures
the full element(s) *plus* their link/sync metadata, so paste can re-resolve:

- **Same slide** → independent copy (fresh ids, offset position).
- **Cross-slide, same deck** → optionally re-link to the source if it still
  exists (join its sync group / share its `linkId`) — the existing
  `pasteElementDelta` + `linkElements` logic, now fed from the clipboard JSON
  instead of `clipboardRef`.
- **Cross-deck** → independent copy; asset-bearing elements carry their asset so
  the bytes travel (embedded, or via the existing asset-copy path) and refs
  don't dangle.

"Enough JSON does wonders": the payload is self-describing; the *paste context*
(same slide / cross-slide / cross-deck) decides how references resolve.

### Paste decision tree

Decided by **cursor/focus state**, then clipboard flavors:

1. **Text caret active** (editing a text box) → insert **inline** into the text
   (the contentEditable path). Eigendeck-marked HTML is trusted (allowlist);
   foreign HTML falls back to `text/plain`.
2. **Slide sidebar focused** + clipboard carries a **slide** flavor → insert a
   new **slide** after the selection.
3. **Canvas** (no caret) → read the private flavor first:
   - elements flavor → paste **objects** onto the current slide (with reference
     resolution above);
   - else `text/html`/`text/plain` → create a **new text box** (even for a
     partial-text copy);
   - else image → insert an **image**.

### Styling on paste — the rules

**Eigendeck text styling is dictated by the element *type*/preset, not by the
pasted content.** In a text element, **font, size, and underline are not
authorable** (Eigendeck has no underline), so they are **never** preserved —
pasted text always adopts the target preset. Preserve only what the format
toolbar can author: **bold, italic, strikethrough, lists, alignment, uppercase +
letter-spacing, and color.** (This means the paste normalizer / `sanitizeRichText`
should also drop `text-decoration: underline`, keeping only `line-through`.)

Color is the one nuance:

- **Internal** (Eigendeck→Eigendeck) → **preserve color** (it was authored
  intentionally).
- **External** (Word, browser, …) → **strip a whole-string color** (a color
  applied uniformly to the entire pasted run is a source default — Word's black,
  WebKit's baked neutral black — and goes invisible on themed/dark slides), so
  the text inherits the deck theme. **Keep sub-range colors** (a color on part of
  the text is an intentional highlight).

So the default paste normalizes to the deck: preset font/size, theme color,
authorable inline styles preserved.

### Paste modes / commands

Three levels, because a text element deliberately can't hold everything:

| Command | Result |
|---|---|
| **Paste** (⌘V) | Smart default. Best-fit into a **text element**, normalized to the deck: preset font/size, theme color (external whole-string color stripped), authorable inline styles kept. |
| **Paste and Keep Style** (⌘⇧V, + Edit menu) | Same text element, but **keep the source's authorable styling we can represent** — including a whole-string color. (Font/size still can't be held by a text element.) |
| **Paste as…** (Edit menu, explicit) | A **Paste-Special chooser** — the manual override for when the smart default picks the wrong representation. |

`Paste and Match Style` semantics are **inverted** from the platform norm here:
default *is* match-destination (styling is element-type-driven), and ⌘⇧V is the
*preserve-source* backup — appropriate for a theme-driven app.

**Paste as…** opens a small modal listing the representations *actually present*
on the clipboard (never a fixed list — only the flavors this clipboard carries),
each mapped to the element type it becomes:

| Representation | Becomes |
|---|---|
| **Text** | text element (as ⌘V) |
| **HTML** | sandboxed **`html` element** (#137) — full source formatting (font, size, color, layout) that a text element would flatten |
| **Image** (PNG/raster) | image element |
| **PDF** | image element (PDF asset) |
| **SVG** | image element (SVG asset) |

This is the industry Paste-Special escape hatch (PowerPoint's "Picture vs Keep
Text Only", InDesign's "Prefer PDF When Pasting"), generalized to whatever the
clipboard actually offers. It also gives us a clean home for "I copied a table
from Word and I *want* the crisp PDF, not text."

### Picking among representations (read order)

There is no single global type priority — the **paste target** decides which
representations it prefers, and we read our **private flavor first**:

1. **Private Eigendeck flavor** (element/slide JSON) → objects/slide. Always
   first, so an internal copy is never mis-picked as a rendered image.
2. Then, for foreign content, the **canvas is text-preferring**: rich text
   (`text/html`/`text/rtf`/non-trivial `text/plain`) → text element; a PDF that
   accompanies rich text is a *rendering* and is skipped (a text-app copy —
   Word/Pages put a PDF next to the real text).
3. **Image / vector** (SVG > PNG > TIFF), and a **PDF with no accompanying rich
   text** (a genuine vector/graphic copy) → image element.
4. `text/plain` → text element.

The `Paste as…` chooser overrides this order on demand.

**Write order matters too.** On copy, put the private flavor and the
representation we most want honored *first* — some readers (browsers, Apple
Pages) are order-sensitive despite the spec saying they shouldn't be.

### Duplicate

**⌘D duplicates the selection in place and never touches the clipboard** — the
industry guard against a stale copy causing an accidental duplicate. Slide-paste
(new slide) vs object-paste (elements onto the current slide) is decided by pane
focus + the presence of a slide flavor, not by a clipboard branch that
duplicates.

## Implementation stages

1. **Kill `clipboardRef`; unify on the clipboard.** Copy writes the private
   element/slide JSON flavor (marker + base64 in `text/html`) + fallbacks. Paste
   reads private-first, live from the clipboard. Removes the desync class.
2. **Paste decision by caret/focus state** + new-text-box-from-text (incl.
   partial-text copy). Retire the App-vs-SlideEditor split into one dispatch.
3. **Styling normalization** — preset font/size, strip external whole-string
   color, keep internal + sub-range colors, keep authorable inline styles.
4. **Paste modes** — ⌘V (normalize), ⌘⇧V "Paste and Keep Style", and the
   Edit-menu **"Paste as…"** chooser (lists the clipboard's actual
   representations → Text / HTML / Image / PDF / SVG).
5. **⌘D duplicate bypasses the clipboard**; slide-paste vs object-paste gated on
   focus + slide flavor.

## Testing

- **Unit**: the private-flavor codec (encode element/slide JSON → `text/html` →
  decode); the styling normalizer (font/size dropped, external whole-string
  color stripped, sub-range color + bold kept, internal color preserved).
- **e2e** (real app, via the eigendeck-e2e rig): copy element → canvas paste =
  object; copy partial text → canvas paste = new text box; copy element →
  foreign copy → canvas paste = foreign content (no stale element); copy slide →
  ⌘V in sidebar = new slide, but ⌘D anywhere = duplicate without a clipboard
  read; external black text → theme color; internal colored text → color kept.

## References

- Alex Harri, "The web's clipboard" — the definitive write-up of `text/html`
  private-payload smuggling + the sync/async clipboard APIs.
- Apple: Pasteboard concepts; `NSPasteboard.types` ("richest type available").
- Microsoft: "Control the formatting when you paste text" (default = keep
  source); PowerPoint theme-color-slot flip (black↔white on paste); copy/paste
  slides (private "Internal Slides" format + pane focus).
- Figma: Copy and paste objects; Guide to text (caret vs layer paste).
- Adobe: Illustrator clipboard (AICB/PDF flavors); InDesign "Prefer PDF When
  Pasting"; paste with no insertion point → new frame at page center.
- Chromium: web custom formats ("pickling"); unsanitized HTML async read.
