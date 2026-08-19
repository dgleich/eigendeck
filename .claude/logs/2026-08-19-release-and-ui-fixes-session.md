# 2026-08-19 — Beta 26.8.17 + present-exit key + toolbar/keyboard fixes

Continues the 2026-08-17 log. Several small, well-scoped fixes; all merged to main
and verified (full e2e gate 118/118 at the end).

## Beta release v26.8.17 (published)

Cut + published as a beta pre-release. Shipped #177 (critical text-edit loss) and
#179 (present wake lock); the HEIC-paste fix (#178) was also in main by then. All
gates green (build, 1521 vitest, clippy, e2e, perf); notarization Accepted.

**#179 verified on real macOS** (by David's Mac agent, via `pmset -g assertions`):
the Screen Wake Lock produces a genuine IOKit `PreventUserIdleDisplaySleep`
assertion during Present, held across alt-tab-with-slide-visible, released on
minimize, genuinely re-acquired on restore (new assertion id), clean on quit.
**#178 verified on macOS** (HEIC copy in Preview → paste inserts). Both closed.

## #180 — Cmd/Ctrl+. also exits Present mode (`3c969b1`)

Escape was the only present-mode exit, and the computer-use / Cowork automation
that verifies releases can't emit Escape into a native app (had to quit the whole
app). First tried a bare `'q'`, but David flagged the collision risk (printable
key vs typing in a demo/notebook field). Analysis showed the collision is largely
contained (parent text fields are guarded by `inEditor`; keys in demo/notebook
iframes don't reach the parent window; the #155 nav-key forwarder only relays
arrows/space) — but David chose **Cmd/Ctrl+.** (the macOS "cancel" chord): not a
text character, safe regardless of focus. Handled next to Escape in
`PresentMode.tsx`; both windows render `<PresentMode>` so the projector is covered.
e2e in `a1-present-escape-invariants-probe` (real Cmd+. keydown → present exits).
Verified on macOS (the agent can emit it). Closed.

## #181 — Multilingual captions feature (filed, not built)

The paused live-Korean-captions brainstorm, captured as an enhancement issue so it
isn't lost: on-device pipeline (Python captions sidecar: mic → faster-whisper →
local EN→KO → stdout → Rust event bridge → a caption bar inside Present mode),
plus the constraints found (fullscreen ⇒ captions must render inside present;
strict CSP forces the Rust bridge; no CJK/Korean font is bundled) and the open
questions. Backlog.

## #182 — "+ Hype" toolbar button was a dead no-op (`f3a080b`)

`runInsert` (App.tsx) had no `case 'hype'` (and no `default`), so the registered
`+ Hype` button silently did nothing while the rest of the feature already existed
(insertItems, TextPreset, defaults, font). Added the case + a `default:` that
`console.warn`s any unhandled insert id — so a future registered-but-undispatched
item fails loudly, not silently.

## #183 — Cmd+D over-duplicating slides (`f3a080b`)

(a) The Cmd+D duplicate handler was guarded only on `d && (ctrl||meta)`, so
Cmd+Shift+D (Debug Console) ALSO duplicated the selected slide — added `!e.shiftKey`.
(b) Clicking the editor canvas sets a `'slide'` selection (SlideEditor:713), so
Cmd+D after clicking into the editor duplicated the slide. Per David's spec, the
slide branch now duplicates only when the slide picker (`.sidebar`, focusable
`.slide-thumbnail`) actually holds focus; otherwise Cmd+D no-ops. Sidebar-selected
Cmd+D still duplicates; element/multi Cmd+D unchanged.

**Test note:** `keyboard-shortcuts-probe` had asserted the OLD behavior (store-select
a slide → Cmd+D duplicates) and failed after (b) — updated it to focus a thumbnail
first (what a real click does). New `insert-dup-keys-probe` covers all three in
real WebKit (4 assertions).

## State

- main = `f3a080b`. Since v26.8.17: #180 (Cmd+. exit), #182, #183 — all merged,
  NOT yet in a published build (next release will bundle them).
- Open backlog worth noting: #181 (multilingual captions) + older enhancements.
- Toolchain/rig still provisioned; no container reset this arc.
