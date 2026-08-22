# Command-line element (live terminal in a slide)

> Design spec. Status: proposed (2026-08-22). Tracks issue #184.
>
> A new slide element type that embeds a real terminal into a deck: live during
> authoring and presenting, captured to a per-slide recording, and baked to inert
> static text for every frozen render (editor idle, thumbnail, HTML export,
> PDF/print). One shared shell session per deck.
>
> **This is the first Eigendeck primitive that turns bytes into command
> execution.** It inverts the app's core "deck data is rendered, never executed"
> invariant, in the highest-privilege frame. The security section below is not
> advisory — its requirements are gates. It incorporates a full design-time
> security review (threat model + ranked risks).

## 1. Motivation & user model

The user gives talks with live command-line demos. Today that means alt-tabbing to
a separate terminal. This element brings the terminal onto the slide, and — the
defining behavior — keeps **one persistent shell session for the whole deck** so a
workflow can be narrated step by step across slides while the shell state (cwd,
env, history, running jobs) and the scrollback carry forward. Adding a second
command-line element on a later slide is not a new terminal; it is another window
onto the same one.

Decisions locked during brainstorming:

- **Live by default, with playback of the last session.** In present (and via an
  explicit "open live terminal" affordance in the editor) it is a real shell you
  type into. "Play back last session" replays the saved recording instead.
- **One terminal, shared scrollback.** Every element is a live window onto the same
  PTY and the same scrollback buffer; `clear` is the reset.
- **Per-slide snapshots.** On each slide advance during a run, the scrollback is
  snapshotted. That ordered set of snapshots is the deck's recording; it drives
  both playback and every frozen render.
- **No auto-run.** Opening/presenting/exporting a deck executes nothing. The deck
  stores no commands, no shell, no env, no cwd. Spawning a live shell is always an
  explicit user gesture, and only on a **trusted** deck (see §7).
- **cwd = the deck's folder** (canonicalized, confined — §7).

Out of scope for v1 (YAGNI): multiple/named parallel sessions; keystroke-timed
"typewriter" playback; author-configured startup commands; any deck-controlled
shell/env/cwd.

## 2. Data model

A new element `type: 'command-line'` (hyphenated, like `demo-piece`). The element is
a thin **viewport marker** — it says "show the deck's terminal here" and carries
only presentation-layer fields; it never carries anything that controls execution.

```ts
interface CommandLineElement extends ElementBase {
  type: 'command-line';
  position: ElementPosition;         // as every element
  // presentation only:
  fontSizeName?: NamedSize;          // reuse the type scale (default 'note'/mono)
  showChrome?: boolean;              // title bar / traffic-light chrome, cosmetic
  // NO shell, NO cwd, NO env, NO command fields — ever (see §7 R5).
}
```

The **recording** is deck-level, not per-element (there is one session per deck).
It is stored as a single dedicated asset (JSON blob, like a demo capture) rather
than in `config`, so it never bloats the hot presentation row:

```ts
interface TerminalRecording {
  version: 1;
  snapshots: Array<{
    slideId: string;                 // keyed by slide ID, NOT index (survives reorder)
    ansi: string;                    // serialized xterm buffer (SGR + safe subset only)
    cols: number; rows: number;
    capturedAt: string;              // ISO; informational
  }>;
  // size-capped on write AND re-validated/truncated on load (untrusted data, §7 R6/R7)
}
```

Snapshot→element resolution: an element on slide `S` renders `snapshots[slideId == S]`.
No snapshot for that slide (never reached, or recording predates the slide) ⇒ the
element shows an inert empty-prompt placeholder. Multiple command-line elements on
one slide resolve to the same snapshot (fine).

Editing the model touches `src/types/presentation.ts` (+ `docs/LLM-EDITING.md` via
the PostToolUse hook) and follows `docs/ELEMENT-CHECKLIST.md` for all render paths.

## 3. Architecture

Three units with clean boundaries:

**(a) Rust PTY owner — `src-tauri/src/pty.rs` (new).** Owns the child shell via the
`portable-pty` crate. Exposes IPC commands (registered in `lib.rs`
`generate_handler!`): `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`. Holds a
single `Mutex`-guarded session handle per deck (mirrors `fscmds::WatchState`).
Streams PTY output to the frontend as a Tauri event. Resolves the shell from the OS
(`$SHELL` / `getpwuid`) or an app preference — **never from the deck** — spawns with
a **sanitized environment** and a **canonicalized, confined cwd**, and guarantees
reaping (kill the process **group** on drop / window-close / `RunEvent::ExitRequested`).

**(b) Frontend live terminal — parent frame only.** xterm.js is instantiated by the
command-line element's React component **directly in the privileged parent window**
(never inside an iframe). `xterm.onData → invoke('pty_write')`; the `pty` output
event → `xterm.write`. No iframe, no `postMessage`, ever, on this path (§7 R1/R2).

**(c) Snapshot pipeline — `src/lib/terminalSnapshot.ts` (new).** Serialize xterm to
ANSI (xterm serialize addon), enforce the allowlist + size caps on capture, and an
**ANSI→inert-HTML converter** for the frozen renders. The converter output is
entity-encoded, closed-tag/attribute allowlisted, and passed through the existing
`src/lib/sanitizeHtml.ts` (DOMPurify) as a backstop (§7 R3/R4).

Data flow, live: user gesture → trust+preference check → `pty_spawn(deckDir)` →
Rust spawns confined shell → output event → parent-frame xterm; keystrokes →
`pty_write`. On each slide advance during a recorded run → `terminalSnapshot`
serializes the buffer → stored under the current slide's ID in the recording asset →
saved with the deck.

Data flow, frozen (editor idle, thumbnail, export, PDF, present-animation, link
overlay): resolve the element's per-slide snapshot → ANSI→inert-HTML → render. **No
frozen path may construct a PTY** (§7 R9). Playback: a **separate** xterm with reply
sequences disabled and no PTY handle in scope replays snapshots with the slides
(§7 R2).

## 4. Live terminal (editor + present)

Spawning is always an explicit gesture — an "open live terminal" control in the
editor and a control (or auto-focus on the element) in present — gated per §7. The
shell spawns on first use and is reaped on close / leaving present / window-close /
app-exit. Because there is exactly one session per deck, all command-line elements
share the single `Mutex`-guarded handle; a second element attaching shows the same
live buffer. Resize is driven from the focused xterm (`pty_resize`, bounds-checked
in Rust).

## 5. Recording & capture

Recording is **explicit and visible** — never silently on. The user opts a session
into recording (a control + a persistent "recording" indicator). While recording,
each slide advance snapshots the current scrollback into the recording asset keyed
by slide ID. On save, the deck discloses that snapshots exist and their size (the
Security window is the natural home; see §7 R6). The user can scrub/clear snapshots
before sharing. Size caps are enforced on capture and re-validated on load.

## 6. Playback & the seven frozen renders

**Playback** ("play back last session") is provably inert: a throwaway xterm
constructed with **no PTY handle in scope** and with reply-generating sequences
(Primary/Secondary DA, DSR, DECRQSS, XTVERSION) disabled/no-op, so replayed bytes
can never become stdin (§7 R2). It advances snapshot-by-snapshot with the slides.

**Frozen renders.** Editor idle, thumbnail, HTML export (GUI + headless CLI),
PDF/print, present-animation, and link overlay all render the element's per-slide
snapshot as inert ANSI→HTML — static styled text, no interactivity, self-contained,
inert under the export CSP. Per `docs/ELEMENT-CHECKLIST.md`, the new element's row
asserts: **PTY spawns in exactly one path (an explicit gesture in editor/present on
a trusted deck); the other six render the inert snapshot and contain no code able to
construct a PTY.**

## 7. Security (gates, not guidance)

### Threat model

- **Assets:** the user's shell/machine (arbitrary code execution is the crown
  jewel); on-screen output and the recording (secrets ride into a *shared* deck);
  the privileged `tauri://localhost` origin (only frame with `invoke`); the exported
  HTML (may be hosted → inherits web-XSS threats the app itself doesn't have).
- **Trust boundaries this feature must not breach:** the opaque-origin sandbox ↔
  privileged frame (the C-3 severance of `allow-same-origin`); frontend ↔ Rust IPC
  (privilege funneled through `#[tauri::command]`s reachable only from a window with
  the capability); deck data ↔ code (a `.eigendeck` is untrusted attacker data).
- **Adversaries:** a **malicious shared deck** (crafts the recording bytes and any
  element fields; fires on open/present/export with no user action); a **malicious
  embedded demo/notebook/html** (already-contained attacker JS in an opaque iframe on
  the same slide, probing for any bridge to the PTY); a **remote viewer of the
  exported HTML** (attacked by whatever the baked terminal escapes carry).

### Hard requirements (non-negotiable)

1. **PTY only over `invoke`, from the `main` window, under a dedicated capability
   scoped `windows:["main"]`** (no `"*"`, no `remote`/remote-IPC domain). No loopback
   socket / custom protocol / HTTP/WS server for the terminal. The existing
   `capabilities/default.json` `windows:["main","*"]` wildcard must be tightened
   **before** this ships — it becomes actively dangerous once a shell-spawner is in
   the handler list. (R1)
2. **No `postMessage` path from any iframe ever reaches `pty_write`/`pty_spawn`/`pty_resize`.**
   xterm.js and all PTY I/O live in the privileged parent frame; keystrokes never
   traverse `postMessage`. The demo relay keeps its invariant of never delivering to
   the app (no new app-facing input sink). An e2e mounts a hostile demo beside a live
   terminal and asserts it cannot spawn or write. (R1)
3. **Playback is provably inert:** a separate xterm with no PTY handle in scope and
   reply sequences (DA/DA2/DSR/DECRQSS/XTVERSION) disabled — replayed bytes can never
   become stdin. Live and playback are distinct components, not one with a flag. (R2)
4. **The ANSI→HTML converter emits only inert, entity-encoded output:** closed
   tag/attribute allowlist; colors parsed into an allowlisted set (never raw ANSI
   strings into `style`); **OSC 52 stripped entirely** (deck data never touches the
   clipboard); OSC 8 links restricted to `http`/`https` with `rel="noopener noreferrer"`
   (no `javascript:`/`data:`/`file:`); final pass through `sanitizeHtml` (DOMPurify).
   Exported terminal HTML carries no script, no `on*=`, no `data:`/`javascript:`/
   external URLs, and is inert under the export CSP. Golden-file test with a hostile
   escape corpus. (R3/R4)
5. **Shell and environment are never deck-controlled.** Shell resolved from OS/user
   prefs in Rust; spawn with a sanitized, app-controlled env that strips the
   auto-exec vars (`BASH_ENV`, `ENV`, `ZDOTDIR`, `PROMPT_COMMAND`, `LD_PRELOAD`,
   `DYLD_INSERT_LIBRARIES`). cwd canonicalized and confined to the real deck folder
   (reject symlink escape). Residual, documented: a live login shell still runs the
   *user's own* rc files and project auto-loaders (direnv `.envrc`, git hooks,
   `.tool-versions`) in that folder — so "no auto-run" is guaranteed by the app for
   deck data, and by **trust** for the user's own environment. That residual is why
   the live shell is gated (Req 6), never reachable implicitly. (R5)
6. **No auto-run in any form; live PTY is off by default and gated.** Spawning
   requires *both* a global preference (off by default, restrictive-only cascade like
   `demoInternetAccess`) *and* per-deck trust (reuse `trustStore.ts`/`trustLedger.mjs`),
   *and* an explicit user gesture. The six non-live render paths spawn nothing. (R5/R9)
7. **Recording is explicit, indicated, reviewable, size-capped.** Never silently
   snapshot; disclose baked scrollback (shared, attacker-readable); bound
   per-snapshot bytes, total recording bytes, line count, and line length; reject or
   truncate oversized recordings on load; bound the escape parser (OSC/DCS string
   length, CSI param count and magnitude, total bytes) and time-box conversion so a
   crafted recording can't hang the privileged frame. (R6/R7)
8. **Guaranteed reaping:** Rust owns the child, killed by process **group** on
   window-close/app-exit/drop (`RunEvent::ExitRequested` + `Drop`); one PTY per deck
   via a mutex-guarded handle; hard cap on live PTYs. (R8)

### Ranked risks (summary)

| # | Sev | Risk | Mitigation (above) |
|---|-----|------|--------------------|
| R1 | Critical | Sandboxed demo reaches spawn/write → RCE | Req 1, 2 |
| R2 | Critical | Replay reply-sequences echo into a live shell's stdin | Req 3 |
| R3 | High | OSC 52 clipboard / OSC 8 links / title via recording | Req 4 |
| R4 | High | Terminal-escape → HTML-breakout XSS in hosted export | Req 4 |
| R5 | High | Deck-controlled cwd/shell/env + rc/auto-loader auto-exec | Req 5, 6 |
| R6 | Med/High | Recording silently exfiltrates on-screen secrets; DoS | Req 7 |
| R7 | Med | Escape-parser DoS in the privileged frame | Req 7 |
| R8 | Med | Orphaned shells / lifecycle leaks | Req 8 |
| R9 | Med | Editor affordance widens the spawn window | Req 6 |
| R10 | Low/Med | resize/signal channel abuse | Req 1 (same capability), bounds-check |

## 8. Testing

- **Unit:** snapshot→element resolution by slide ID (survives reorder/insert);
  ANSI→HTML inertness golden-file (`</style>`, `"><script>`, OSC 8 `javascript:`,
  OSC 52, title, DCS); size-cap enforcement on write and on load; Rust env
  sanitization + cwd canonicalization/confinement.
- **e2e (WebKitGTK rig, Linux):** hostile-demo-beside-live-terminal cannot
  spawn/write (the R1 gate); spawn→type→snapshot capture round-trips; playback of a
  recording containing crafted reply sequences never reaches a shell (R2); export
  bakes an inert snapshot (no script/handlers/remote URLs); reaper kills the child on
  window-close; trust/preference gate blocks spawn on an untrusted deck / with the
  preference off.

## 9. Files touched (map)

- `src/types/presentation.ts` — the element type + recording types (`docs/LLM-EDITING.md`).
- `src/components/SlideElementRenderer.tsx` — parent-frame xterm (live), inert
  snapshot render (frozen), no PTY in the six frozen paths.
- `src/lib/terminalSnapshot.ts` (new) — serialize + allowlist + ANSI→inert-HTML.
- `src/lib/sanitizeHtml.ts` — reused as the converter/export backstop.
- `src/lib/trustStore.ts` / `trustLedger.mjs` — spawn gating.
- `src/store/presentation.ts` — recording state, capture-on-advance, playback mode.
- `src-tauri/src/pty.rs` (new) — PTY owner, sanitized spawn, reaper, `Mutex` handle.
- `src-tauri/src/lib.rs` — register the PTY commands.
- `src-tauri/capabilities/` — a dedicated PTY capability `windows:["main"]`; tighten
  the `default.json` `"*"` wildcard.
- `src/lib/exportCore.mjs` / print path — bake the inert snapshot.
- `docs/ELEMENT-CHECKLIST.md` — the new element's row (PTY-in-exactly-one-path).

## 10. Future (not v1)

Named/parallel sessions; keystroke-timed typewriter playback; delta-compressed
recordings; a "safe demo" mode that records on the author's machine and ships
playback-only to recipients.
