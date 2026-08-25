# Security audit — privileged webview boundary (2026-08-25)

Status: **phase 1 complete — source review and existing-test verification.** This
pass covers Tauri commands/capabilities, privileged HTML/SVG sinks, iframe message
boundaries, and alternate presentation-ingress paths. It does not yet cover
malformed-SQLite resource exhaustion, Jupyter protocol behavior, or the YouTube
loopback shim in depth.

## Threat model used

A received `.eigendeck` file, pasted clipboard HTML, demo HTML, notebook output,
and persisted cache/history rows are untrusted. The privileged app document can
invoke registered Tauri commands. A sandboxed demo is expected to execute script,
but must not be able to cause script execution in the privileged document or call
Tauri IPC.

## Findings

### C-1 — sandboxed demo could forge MathJax replies and inject privileged SVG

**Severity: Critical. Status: fixed 2026-08-25 with an inert provenance regression
test; real-WebKit defense-in-depth coverage remains desirable.**

`mathjaxRenderer` accepts `message` events based only on `msg.type` and a pending,
predictable id (`r1`, `r2`, ...). It does not require `ev.source` to equal the
corresponding MathJax iframe (`src/lib/mathjaxRenderer.ts:135-166,275-289`). Every
sandboxed demo can call `window.parent.postMessage`. A hostile demo can therefore
race/flood a forged `{type:"rendered", id:"rN", svg:"..."}` response while a
slide containing uncached math is rendering.

Fresh renderer replies deliberately skip `sanitizeSvg`; only SVG loaded from the
SQLite cache is sanitized. The forged SVG consequently flows through
`buildTextElementSvgMarkup` and then `dangerouslySetInnerHTML` in the privileged
document (`src/components/TextElementSvg.tsx:88-120,185-197`).

Because the privileged document has Tauri IPC, successful script execution can
reach commands including arbitrary-path writes (C-3), making this a sandbox escape
rather than a display-only injection.

Recommended fix:

1. Store the expected source window with every pending request and reject unless
   `ev.source === pool.iframe.contentWindow`.
2. Apply the same source check to `ready`, `preamble-applied`, errors, and logs.
3. Sanitize every returned SVG at the renderer-to-parent boundary even when the
   expected iframe sent it (defense in depth).
4. Add a real WebKit e2e fixture with a demo that forges renderer messages and
   assert that a marker cannot appear in the privileged DOM/global state.

Implemented: renderer results, errors, readiness, preamble acknowledgements, and
logs now require `MessageEvent.source` to be the owning hidden MathJax iframe.
`src/lib/mathjaxRenderer.security.test.ts` sends a harmless `data-proof` SVG reply
with the real predictable request id, first from a non-owning window (must remain
pending) and then from the owning renderer window (must resolve). The test fails on
the pre-fix listener without executing script or invoking Tauri.

### C-2 — unvalidated element properties break out of generated SVG attributes

**Severity: Critical. Confidence: High (string construction confirmed; real-WebKit
event execution still required).**

The SQLite loader parses element `data` as arbitrary JSON and performs no runtime
schema validation. TypeScript types do not constrain a crafted deck at runtime.
`buildTextElementSvgMarkup` interpolates `position.width`, `position.height`,
`fontFamily`, color, and other values directly into quoted markup/style strings.
The resulting string is installed with `dangerouslySetInnerHTML`.

For example, a nonnumeric width containing a quote creates an additional SVG
attribute at `src/components/TextElementSvg.tsx:110-114`. This bypasses the rich-
text sanitizer because the payload is in an element property, not `element.html`.
It is reached automatically when the affected slide is displayed.

Recommended fix:

- Validate and normalize the entire presentation at every untrusted ingress.
  Require finite bounded numbers for geometry/visual numeric fields, enums for
  discriminants, known font identifiers (or safely escaped family strings), and
  syntactically valid colors.
- Stop assembling DOM markup with unescaped values. At minimum XML-attribute
  escape every attribute and CSS-escape/validate every style value; preferably
  build the outer SVG with React/DOM APIs.
- Add malicious-property tests covering quotes, control characters, `NaN`,
  infinities, huge values, and wrong JSON types.

### C-3 — registered commands provide ambient arbitrary filesystem mutation

**Severity: High independently; Critical as an impact amplifier. Confidence: High.**

`write_file`, `write_text_file`, `make_dir`, `path_stat`, `path_exists`,
`read_dir`, `watch_path`, and `resolve_and_read` accept caller-provided paths.
The write commands perform no path or caller-window authorization
(`src-tauri/src/fscmds.rs:23-104`). The command handler is shared by all app
windows. Tauri capability configuration also applies broad permissions to
`["main", "*"]` (`src-tauri/capabilities/default.json:5`).

Removing the fs-plugin permission is useful, but does not remove ambient disk
access when equivalent unrestricted custom commands remain registered. Any
privileged-document injection therefore becomes arbitrary read/write with the
app user's permissions.

Recommended fix:

- Split commands by purpose and authorize the invoking window.
- Replace arbitrary paths with short-lived, app-side grants minted after a native
  picker or with narrowly scoped app-data/deck paths.
- Keep external asset reads behind one Rust-side authorization operation; do not
  rely on JavaScript performing the trust decision after `resolve_and_read` has
  already returned bytes.
- Remove release registration of `read_dir` if it is genuinely debug-only.
- Define explicit per-window Tauri capabilities instead of `"*"`.

### H-1 — history and clipboard paths bypass presentation normalization

**Severity: High. Confidence: High.**

The current presentation is rich-text sanitized during normal deck open. However:

- Cross-session undo snapshots returned by `db_get_state_at` are inserted directly
  into zundo (`src/store/presentation.ts:1081-1087`). Undo can restore their raw
  element data.
- History restore passes `previewData` directly to `setPresentation`
  (`src/components/HistoryPanel.tsx:180-187`).
- Clipboard HTML can self-identify as an Eigendeck clip by carrying a public,
  unauthenticated base64 attribute (`src/lib/clipboardModel.ts:57-69`). Elements
  and slides decoded from it are cloned directly into the store
  (`src/lib/pasteClip.ts:29-57`, `src/store/presentation.ts:351-360`).

These paths bypass even the current `element.html` sanitizer and would also bypass
the full schema validation required for C-2.

Recommended fix: create one fail-closed `normalizeUntrustedPresentation` /
`normalizeUntrustedElement` boundary and call it for open/import, history preview
and restore, undo seeding, clipboard elements/slides, and any cross-window payload.
Do not treat the clipboard marker as an authenticity boundary.

### M-1 — production DOMPurify version has a published XSS advisory

**Severity: Moderate. Confidence: High (`npm audit --omit=dev`).**

The lockfile resolves `dompurify` 3.4.12. `npm audit` reports
GHSA-55q2-fjhq-7xh7 (affected range `<=3.4.12`) and a fix is available. DOMPurify
is a direct production security dependency used at privileged injection sinks.

Recommended fix: update DOMPurify to a fixed release, review upstream behavioral
changes, then rerun all sanitizer and notebook-output tests plus malicious corpus
tests in WebKit.

### M-2 — presenter navigation messages do not authenticate their source

**Severity: Moderate/Low. Confidence: High.**

`PresentMode` accepts any window message shaped as
`{__eigendeck:1,type:"nav-key",key:...}` without checking that its source is one
of the mounted demo frames (`src/components/PresentMode.tsx:198-218`). A framed
third-party video/provider can therefore navigate the deck if it sends that shape.
This is an integrity/availability issue, not currently a privileged-code path.

Recommended fix: maintain the set of mounted bridge iframe windows and accept
bridge messages only from that set. Apply the same policy centrally to all demo
message types.

## Existing controls that held up in this pass

- Demo frames use opaque-origin `sandbox="allow-scripts"`, without
  `allow-same-origin`.
- Raw HTML elements omit `allow-scripts` and inject a no-network CSP.
- Notebook static HTML/SVG and markdown are routed through DOMPurify; executable
  output is placed in an opaque-origin iframe.
- Cached MathJax SVG is sanitized when loaded from SQLite.
- External asset type gates have a substantial existing unit-test matrix.
- The Tauri asset protocol is disabled and no fs-plugin capability is granted.

These controls do not mitigate C-1/C-2 because those findings cross into the
privileged document through separate trusted-string assumptions.

## Verification performed

- Focused security suites: 352 tests passed.
- Full Vitest suite: 109 files passed, 1 skipped; 1521 tests passed, 1 skipped.
- `npm audit --omit=dev`: one moderate production vulnerability (DOMPurify).
- Rust verification was not run because `cargo` is not installed in this
  container (`/bin/sh: cargo: not found`).

## Next audit phases

1. Add safe regression/e2e probes for C-1 and C-2, then fix them before deeper
   review because they invalidate assumptions made by lower layers.
2. Audit malformed SQLite, JSON shape/size limits, decompression/image/PDF limits,
   and denial-of-service behavior.
3. Audit Jupyter token migration/storage, REST/WebSocket origin handling, and
   kernel execution UX.
4. Audit the loopback YouTube shim (token, Host/Origin checks, DNS rebinding,
   lifecycle, and response headers).
5. Audit export HTML as an independent browser artifact and clipboard/pasteboard
   parsing on each platform.

## Remediation (2026-08-25)

Response to the findings above. Four of six are fixed and shipped to `main`; the two
remaining are the architectural one (C-3) and the lowest-severity one (M-2). Each
finding below was independently re-confirmed against the code before fixing.

**Review round (important):** the first C-2 attempt (`329a1f3`, ingress-only) was
reviewed and found **incomplete** — it validated four properties but missed `padding`
and deck-level `config.textSizes`, the normalizer threw (fail-open) on a malformed/null
element, and a second sink (`textElementHtml`, used by HTML export + PDF) was
unescaped. `c10c94a` closes all of these by **escaping at both shared builders** and
completing the normalizer. A **second** review round then found the EXPORT path still
open (unescaped `absBox`/media attrs + an un-normalized CLI); `0694b1c` closes that. The
status below reflects the post-review state, with one Medium residual noted under C-2.

| # | Severity | Status | Commit |
|---|----------|--------|--------|
| C-1 | Critical | **Fixed** | `1e7d61f` |
| C-2 | Critical | **Fixed** (review-hardened, 2 rounds) | `329a1f3` + `c10c94a` + `0694b1c` |
| H-1 | High | **Fixed** (all three ingress paths) | `a162853`, `e65d8da`, unified in `329a1f3`/`c10c94a`/`0694b1c` |
| M-1 | Moderate | **Fixed** | `5ff6449` |
| C-3 | High / Critical-amplifier | **Open** | — |
| M-2 | Moderate/Low | **Open** | — |

### C-1 — mathjax forged replies (fixed, `1e7d61f`)

Every renderer message — `rendered`, `error`, `ready`, `preamble-applied`, and `log` —
now requires `ev.source === pool.iframe.contentWindow`, so a sandboxed demo can no
longer forge a reply with a guessed request id. `rendered`/`error` share the one
source-checked reply loop. Regression test `src/lib/mathjaxRenderer.security.test.ts`
sends a real predictable id from a non-owning window (must stay pending) and then from
the owning iframe (must resolve); it is inert (a `data-proof` marker, no script). The
optional DiD of sanitizing *fresh* replies (rec #3) was **not** taken — the source
check fully closes the forge vector, and the cache-load path already sanitizes the same
SVGs — but it remains a cheap future hardening.

### C-2 — element-property SVG breakout (fixed, `329a1f3` + `c10c94a`)

Fixed in the two layers the audit recommended (validate ingress + stop trusting
interpolated values), landed across two commits after a review round.

**Primary defense — escape at the sinks (`c10c94a`).** Both shared text builders that
string-concatenate element properties into a quoted `style`/attribute and then
`dangerouslySetInnerHTML` — `buildTextElementSvgMarkup` (app display + HTML export) and
`textElementHtml` (HTML export + PDF/print) — now escape **every** dynamic value
(`" < > &`). Because `escAttr` leaves single-quotes, legit CSS (`'PT Sans', sans-serif`,
`#hex`, `px`) is byte-identical (WYSIWYG; 116 export/print tests unchanged), while a
crafted value cannot break out of the attribute. This closes the breakout for **all**
interpolated fields regardless of which property or ingress — including the ones the
first attempt missed (`padding`, and sizes flowing from `config.textSizes`), the
hosted HTML-export and PDF artifacts, and any fail-open path (an un-normalized deck
still cannot inject). The inner `content` is the already-sanitized html and is
deliberately left as HTML.

**Defense-in-depth — the ingress normalizer (`329a1f3`, completed in `c10c94a`).**
`src/lib/normalizePresentation.ts` sanitizes text html and validates each property
against its known-safe shape — `position.{x,y,width,height}`, `fontSize`, and every
`padding` side must be finite numbers; `fontFamily`/`color` must carry no breakout
character; deck-level `config.textSizes` entries that aren't finite are stripped —
**dropping the whole element** on anything out of shape. `normalizeUntrustedElement`
is **total**: `null`/non-object/malformed input returns `null` instead of throwing, so
a malformed element can no longer abort the pass and leave an earlier unsafe element
installed (the fail-open the review flagged). `fontFamily` uses a safe-character check,
not a registry allowlist, so the documented per-element font override keeps working.

**Export path (`0694b1c`) — a second review round found "both text builders" was NOT
the whole export defense.** The HTML export is a self-contained, often *hosted* artifact
with its own render path: `buildExportHtml`'s shared `absBox()` (the wrapper for EVERY
element type) and the media `href`/`src`/`background` attributes were unescaped, and the
CLI export (`export-cli.ts`) read the deck straight from SQLite and never normalized —
so a crafted deck exported by the CLI could emit active HTML. Fixed in two layers: (1)
`normalizeUntrustedPresentation` now runs at **both** export entries — the CLI (a hidden
webview, so DOMParser is available) and the GUI (`fileOps`, DiD) — sanitizing text html
and dropping out-of-shape elements; (2) `escExportAttr` escapes the export builder's own
interpolations (absBox geometry, video/image/iframe urls, text-box background/shadow/
radius/rotation). WYSIWYG preserved (116 export/print tests unchanged).

**Remaining residual (Medium, tracked):** escaping attribute delimiters stops HTML
breakout but is **not CSS-value validation** — a `url()` / `@import` in a color/background
field that carries no `;` (so the normalizer's breakout-char check doesn't reject it, and
escaping leaves it intact) can still load a network resource in the exported artifact
(a beacon, not code execution). Closing it needs color-shape validation of `color`/
`backgroundColor` (accept hex/rgb/hsl/named, reject `url(`). Not yet done.

**Coverage of the normalizer's transparency test:** it covers current element rows +
`config.textSizes`, not temporal history / slide config / assets. Those are covered by
the *sink escaping* (which holds regardless of source), not by the transparency test.

### H-1 — history/clipboard/undo ingress bypasses (fixed)

All three paths the finding lists now run the normalize boundary: undo seeding
(`seedUndoHistory`, first in `a162853`, now `normalizeUntrustedPresentation`), history
restore (`HistoryPanel`), and clipboard paste (`pasteClip`, per-element with drop).
This realises the finding's "one boundary called at every ingress" recommendation — the
same `normalizeUntrustedPresentation` runs at deck open, undo-seed, history restore, and
clipboard, and C-2's property validation rides along. The clipboard marker is still
treated as data, not an authenticity boundary.

### M-1 — DOMPurify advisory (fixed, `5ff6449`)

Bumped `dompurify` 3.4.12 → 3.4.14 (GHSA-55q2-fjhq-7xh7). `npm audit --omit=dev` now
reports **0 vulnerabilities**; sanitizer + notebook-output tests green.

### C-3 — ambient fs + capability wildcard (OPEN)

Not yet addressed — it is architectural (per-window capability split; short-lived,
narrowly-scoped path grants instead of ambient caller-provided paths) and warrants its
own focused pass, ideally co-verified. **Note:** the `capabilities/default.json`
`windows:["main","*"]` wildcard this finding calls out is the *same* prerequisite the
command-line (live-terminal) design lists as blocking — see
`docs/COMMAND-LINE-ELEMENT.md` §7 Req 1. Tighten it before either ships.

### M-2 — presenter nav-key source (OPEN)

Not yet addressed — lowest severity (deck-navigation integrity only; no privileged-code
path). The fix (accept `nav-key` only from the set of mounted demo-bridge frames) needs
demo-host frame-registry plumbing; deferred as a cleanup.

### Verification (remediation pass)

- Full Vitest: **1547 passed, 1 skipped** (adds the C-1 provenance test, the C-2 unit +
  robustness tests, the sink-escape test, and the shipped-deck transparency test).
- `tsc --noEmit`: clean. `npm audit --omit=dev`: 0 vulnerabilities. The two shared text
  builders' escape is byte-identical on legit content (116 export/print tests unchanged).
- **Transparency guarantee for the normalizer:** `src/lib/normalizePresentation.decks.test.ts`
  runs it over **every** `examples/` + `test-presentations/` deck (40, read from temp
  copies so no `-wal` sidecar touches tracked files) and fails with a precise
  deck+element+reason if any real element would be dropped OR any `config.textSizes`
  entry removed. It currently alters nothing — so the fail-closed rules cannot silently
  delete legitimate content. (Scope: current element rows + config.textSizes; temporal
  history / slide config / assets are covered by the sink escaping, not this test.)
- Rust (C-3) not exercised — no Rust change was made this pass.

### Recommended next steps

1. Add the real-WebKit e2e probes the audit asked for (C-1 forged-message-beside-live
   render; C-2 crafted-property deck) to lock the fixes end-to-end in the shipped engine.
2. Scope C-3 as its own effort, folded together with the #184 capability-tightening
   prerequisite.
3. Close M-2 as a small cleanup when convenient.
