# 2026-07-20 (overnight) — caret double-paste fix, copy/paste review, Paste as…

Continued on branch `feat/copy-paste-redesign` (all pushed). David reported a
double-paste bug at bedtime and asked for: review that bug class, review the
copy/paste work so far, fix what comes up, then build Paste as… (Stage 4).
Everything below is committed + pushed; **not merged to main**.

## 1. The reported bug — caret double-paste (FIXED, commit 9dfb8b1)

**Symptom** (deck `gitignore/ctxmenu.eigendeck`, slide 2): editing the text
element in caret mode, copied text from a terminal, hit ⌘V → got BOTH a new
element on the canvas AND the text inserted at the caret.

**Root cause** (confirmed by two review agents): the window-level paste/copy
guards decided "caret edit vs canvas" purely from `e.target.closest(
'[contenteditable="true"]')`. WebKit can dispatch a keyboard-initiated paste
with `event.target = <body>` while the caret is in a contentEditable — the guard
then fails, the canvas handler builds an element, and the browser's default
paste still inserts at the caret. The caret-level `onPaste`/`onCopy` also never
called `stopPropagation()`.

**Fix**: new `src/lib/editableTarget.ts` `eventInTextEditor()` consults **focus
(`document.activeElement`) + the selection anchor**, not just `e.target`, and now
guards both window paste handlers (App + SlideEditor) and the window copy
handler. Added `stopPropagation()` to the caret `onCopy`/`onPaste` as
defense-in-depth. `eventInTextEditor` also covers INPUT/TEXTAREA, closing a
latent gap where a canvas paste could fire inside a plain input.
Reproduction test included (`editableTarget.test.ts`, the target=body case).

> Note: I could unit-test the guard logic and reproduce the target=body case,
> but the *live* WebKit dispatch quirk is a real-WebKit behavior — worth a quick
> confirm on the Mac that the double-paste is actually gone in the app.

## 2. Copy/paste correctness review — other findings

Two agents reviewed the whole branch. I fixed the 3 clear, low-risk ones in the
same commit (9dfb8b1):
- **Cross-slide IMAGE paste offset the position by (40,40)**, drifting a linked
  image on the target slide. Now offsets only for a same-slide paste, matching
  the element path.
- **`decodeClipHtml` only accepted double-quoted** `data-eigendeck-json`; a
  pasteboard re-serialization (macOS public.html) with single quotes silently
  downgraded an internal paste to the screenshot/text fallback. Now accepts both.
- **Multi-block uniform default color** (Word/Docs emit the same color on every
  paragraph; each `<p>` covers only part of the text, so the whole-string strip
  missed it → invisible on dark themes). `normalizePastedStyles` now strips a
  uniform color that covers ALL the text; different-color/partial sets are kept.
  (3 new matrix cases.)

The **remaining 6 findings** are more involved / cross-deck / tied to Stage 5, so
I filed them as **#167** rather than rushing them overnight: whole-slide paste
still duplicates the current slide (Stage 5); multi-select copy with an image
drops asset bytes cross-deck; synced image cross-slide doesn't join the sync
group; html-element source goes to the OS clipboard unsanitized (foreign-paste
producer); data-URL `<img>` extraction can drop surrounding rich content; a
narrow silent no-op if `clip_paste_asset` fails. Details + pointers in #167.

## 3. Paste as… — Stage 4 (DONE, commit 39a2e9f)

Built the chooser: pick which clipboard representation to paste instead of the
auto ladder.
- `src/lib/pasteAs.ts` — `clipboardRepresentations()` (raw UTI/MIME list →
  Image/SVG/PDF/HTML/Text, pure + tested), `gatherClipboardTypes()` (native
  NSPasteboard ∪ async Clipboard API), `readRepresentation(kind)` (native-first
  read of the chosen bytes/text).
- `PasteAsModal.tsx` — in-webview chooser (number-key select, Esc cancels).
- Triggers: native **Edit → Paste as…** (`lib.rs`, via the menu-event relay) and
  a **canvas context-menu** entry. On pick, App dispatches `eigendeck:paste-as`
  and **SlideEditor performs the insert with its existing helpers** (no
  duplicated insert logic).

**Decision you flagged**: you'd prefer the system dialog. There's no OS "paste
special" dialog API; the native equivalent is a popup menu at the cursor. I
shipped the in-webview modal (cross-platform + headless-testable) and filed
**#168** to upgrade it to a native popup menu (macOS first). ⌘⇧V "Keep Style" is
still TODO (today ⌘⇧V = paste plain text while editing).

> Verified via unit + component tests, full build, and cargo clippy. NOT yet
> exercised in the live app / e2e rig — worth a smoke test on the Mac
> (Edit → Paste as…, and right-click → Paste as… on the canvas).

## State
- Branch `feat/copy-paste-redesign` @ 39a2e9f, pushed, not merged.
- Tests: **1479 passing**, tsc clean, build clean, cargo check + clippy clean.
- New issues: **#166** (clipboard-format corpus), **#167** (deferred copy/paste
  findings), **#168** (native Paste-as popup).
- Stages: 1–3 done earlier; **4 done** tonight; **5** (⌘D duplicate bypass +
  proper slide-paste, ties #165) remains, plus ⌘⇧V Keep Style.
