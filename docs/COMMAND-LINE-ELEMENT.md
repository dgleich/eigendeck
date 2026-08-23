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

- **The element shows its last recording; going live is the only action.** There is
  no "record" mode to arm — a live session records by default (no one wants to
  remember to turn recording on mid-talk). A command-line element renders its stored
  playback (static) whenever a recording exists.
- **Connect choices are contextual, and that's the whole UX.** A *fresh* element (no
  recording) shows one **"Connect to live terminal"** affordance; connecting records
  (there's nothing to lose, and you need a recording to have content). An element
  *with* a recording shows the playback plus two options — **"Connect & update
  recording"** (records, overwriting the stored history) and **"Connect, keep
  recording"** (live, stores nothing, so a clean take survives). "Store history or
  not" is just which button you press — never a modal, never an arm/disarm toggle.
- **One terminal, shared scrollback.** Every element is a live window onto the same
  PTY and the same scrollback buffer; `clear` is the reset.
- **Per-slide snapshots.** During a live *store* session, the scrollback is
  snapshotted on each slide advance, keyed by slide ID. That ordered set is the
  deck's recording; it drives playback and every frozen render.
- **No auto-run, and no connect prompt.** Opening/presenting/exporting executes
  nothing; the deck stores no commands, shell, env, or cwd. The live shell spawns in
  **`$HOME` and `cd`s to the deck's folder** with a Rust-sanitized env, so
  connecting a deck someone sent you runs nothing until you type it — no trust
  prompt, no global enable toggle (see §7).
- **Secret scanning gates only export.** A live store session is scanned as it
  records; flagged content shows a loud in-element warning and is withheld from
  export unless you opt in *on that element* (§5b/§7). Nothing gates showing it live
  or in the app.

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

Data flow, live: user "connect" gesture → `pty_spawn(deckDir)` → Rust spawns the
sanitized shell in `$HOME` and `cd`s to the confined deck folder → output event →
parent-frame xterm; keystrokes → `pty_write`. During a *store* connection, each slide
advance → `terminalSnapshot` serializes the buffer → stored under the current slide's
ID in the recording asset → saved with the deck. A *keep* connection stores nothing.

Data flow, frozen (editor idle, thumbnail, export, PDF, present-animation, link
overlay): resolve the element's per-slide snapshot → ANSI→inert-HTML → render. **No
frozen path may construct a PTY** (§7 R9). Playback: a **separate** xterm with reply
sequences disabled and no PTY handle in scope replays snapshots with the slides
(§7 R2).

## 4. Live terminal (editor + present)

The only spawn path is the explicit **"Connect to live terminal"** gesture (§1) — in
the editor and in present. There is no trust prompt or global toggle; safety comes
from the clean-spawn model (§7 Req 5): the login shell starts in `$HOME` with a
Rust-sanitized env, then `cd`s into the deck's (canonicalized, confined) folder, so
nothing runs until the user types. The shell is reaped on disconnect / leaving
present / window-close / app-exit. Because there is exactly one session per deck, all
command-line elements share the single `Mutex`-guarded handle; a second element
attaching shows the same live buffer. Whether the session records is set by *which*
connect the user chose (store vs keep, §5). Resize is driven from the focused xterm
(`pty_resize`, bounds-checked in Rust).

## 5. Recording & capture

Recording is not a mode you arm — it is a property of *how you connected*. A
**store** connection ("Connect to live terminal" on a fresh element, or "Connect &
update recording" on one that has a recording) records; a **keep** connection
("Connect, keep recording") does not. There is no record on/off toggle and no
"remember to turn it on."

While a store session is live, each slide advance snapshots the current scrollback
into the deck-level recording asset, keyed by slide ID (§2). A store connection
**replaces** the prior recording: as you advance through slides live, each slide's
snapshot is overwritten with the new take; this is the "overwrite any existing
history" behavior. A keep connection writes nothing. Size caps are enforced on
capture and re-validated on load (§7 R7). The Security window still lists that a
recording exists and its size (disclosure), but there is **no export-time nag** —
export just works, minus anything the secret scan withholds (§5b).

### 5b. Secret scan & the export gate

Two things run over a store session's output — one automatic and invisible, one
surfaced to the author:

1. **Strip bad content (automatic, always).** Dangerous escape sequences (OSC 52
   clipboard writes, etc.) are neutralized on capture and again on render, with no
   user involvement — this is the inertness sanitization of §7 R3/R4, not a choice.

2. **Watch for secrets (flag, don't block in-app).** As the session records, a
   lightweight scanner looks for likely secrets — API keys and tokens by known shape
   (`AKIA…`, `ghp_…`, `xox[baprs]-…`, Google `AIza…`), PEM private-key blocks, JWTs,
   `password:`/`secret`/`token=` echoes, and high-entropy strings. A hit marks that
   slide's snapshot as **flagged** and paints a loud, unmissable warning banner on
   the element in the editor ("possible secret in this terminal's output — not safe
   to share").

The **export gate lives on the element, never in the export dialog.** A flagged
element carries an explicit **"I've reviewed this — allow export"** control, default
OFF. On export / PDF / print:

- Flagged **and not** opted-in → the terminal is replaced in the output by an inert
  placeholder: *"Terminal output withheld — a possible secret was detected"* plus a
  pointer to the element's review control. The scrollback bytes are **not written**
  to the exported file.
- Not flagged, **or** opted-in → the snapshot exports normally, silently.

So the author is never nagged by the export flow; they are stopped only when
something genuinely risky was detected, and the fix is a single click on the exact
element that has the problem. The scan is a heuristic safety net, not a guarantee —
the warning copy says as much, and the author remains responsible for what they
share.

## 6. Playback & the seven frozen renders

**Playback** ("play back last session") is provably inert: a throwaway xterm
constructed with **no PTY handle in scope** and with reply-generating sequences
(Primary/Secondary DA, DSR, DECRQSS, XTVERSION) disabled/no-op, so replayed bytes
can never become stdin (§7 R2). It advances snapshot-by-snapshot with the slides.

**Frozen renders.** Editor idle, thumbnail, HTML export (GUI + headless CLI),
PDF/print, present-animation, and link overlay all render the element's per-slide
snapshot as inert ANSI→HTML — static styled text, no interactivity, self-contained,
inert under the export CSP. The **exportable** paths (HTML export, PDF/print)
additionally honor the §5b gate: a flagged, not-opted-in element renders the
"withheld" placeholder instead of its bytes. Per `docs/ELEMENT-CHECKLIST.md`, the
new element's row asserts: **PTY spawns in exactly one path (an explicit "connect"
gesture in editor/present); the other six render the inert snapshot (subject to the
export gate) and contain no code able to construct a PTY.**

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
5. **Shell, environment, and cwd are never deck-controlled; the shell spawns clean.**
   The shell is resolved from OS/user prefs in Rust (`$SHELL`/`getpwuid`), never from
   the deck. Spawn with a sanitized, app-controlled env that strips the auto-exec
   vars (`BASH_ENV`, `ENV`, `ZDOTDIR`, `PROMPT_COMMAND`, `LD_PRELOAD`,
   `DYLD_INSERT_LIBRARIES`). Start the login shell in **`$HOME`**, then `cd` into the
   deck's folder (path canonicalized in Rust, confined to the real deck directory,
   symlink escape rejected). Because the deck supplies no shell/command/env and the
   common cwd auto-loaders (direnv, mise/asdf) enforce their *own* per-directory trust
   before running any of a folder's config, connecting a foreign deck executes
   nothing until the user types a command — so **no Eigendeck trust prompt or global
   enable toggle is required** (this deliberately supersedes the security review's
   off-by-default-preference + per-deck-trust recommendation; the clean-spawn model
   removes the auto-exec risk that gating existed to cover). Documented residual: a
   non-trust-gated auto-on-`cd` tool the *user themselves* installed would run, and a
   git command the user types in a repo shipping a malicious `core.fsmonitor` would
   run it — both the user's own environment and actions, not silent deck execution. (R5)
6. **The "connect" gesture is the only spawn path; the six non-live render paths spawn
   nothing.** A live PTY is constructed only by an explicit "Connect to live terminal"
   action in the editor or present. Editor idle, thumbnail, HTML export, PDF/print,
   present-animation, and link overlay contain no code able to construct a PTY
   (verified per `docs/ELEMENT-CHECKLIST.md`). Opening/presenting/exporting never
   spawns anything. (R5/R9)
7. **Recording is bounded and disclosed; capture only on an explicit store connect.**
   Snapshots are written only during a store-mode live session (the user's explicit
   "connect & record" choice — never otherwise). The deck discloses that a recording
   exists and its size (Security window); bound per-snapshot bytes, total recording
   bytes, line count, and line length; reject/truncate oversized recordings on load;
   bound the escape parser (OSC/DCS string length, CSI param count and magnitude,
   total bytes) and time-box conversion so a crafted recording can't hang the
   privileged frame. On-screen-secret exfiltration is handled by Req 9. (R6/R7)
8. **Guaranteed reaping:** Rust owns the child, killed by process **group** on
   window-close/app-exit/drop (`RunEvent::ExitRequested` + `Drop`); one PTY per deck
   via a mutex-guarded handle; hard cap on live PTYs. (R8)
9. **Secret scan gates export, on the element.** A store session's output is scanned
   for likely secrets; a hit flags that snapshot, paints a loud in-element warning,
   and withholds the content from HTML export / PDF — an inert "withheld" placeholder
   replaces the bytes — unless the author sets the per-element "allow export" opt-in.
   The gate lives on the element, not the export dialog; export is never otherwise
   nagged. Escape stripping (Req 4) still applies to everything that *is* exported.
   The scan is a heuristic safety net, not a guarantee, and the warning copy says so. (R6)

### Ranked risks (summary)

| # | Sev | Risk | Mitigation (above) |
|---|-----|------|--------------------|
| R1 | Critical | Sandboxed demo reaches spawn/write → RCE | Req 1, 2 |
| R2 | Critical | Replay reply-sequences echo into a live shell's stdin | Req 3 |
| R3 | High | OSC 52 clipboard / OSC 8 links / title via recording | Req 4 |
| R4 | High | Terminal-escape → HTML-breakout XSS in hosted export | Req 4 |
| R5 | High | Deck-controlled cwd/shell/env + folder auto-loaders exec on connect | Req 5, 6 |
| R6 | Med/High | Recording captures on-screen secrets into a shared deck; oversized-snapshot DoS | Req 7, 9 |
| R7 | Med | Escape-parser DoS in the privileged frame | Req 7 |
| R8 | Med | Orphaned shells / lifecycle leaks | Req 8 |
| R9 | Med | Editor affordance widens the spawn window | Req 6 |
| R10 | Low/Med | resize/signal channel abuse | Req 1 (same capability), bounds-check |

## 8. Testing

- **Unit:** snapshot→element resolution by slide ID (survives reorder/insert);
  ANSI→HTML inertness golden-file (`</style>`, `"><script>`, OSC 8 `javascript:`,
  OSC 52, title, DCS); size-cap enforcement on write and on load; Rust env
  sanitization + cwd canonicalization/confinement; the secret scanner flags a known
  key shape and passes clean output.
- **e2e (WebKitGTK rig, Linux):** hostile-demo-beside-live-terminal cannot
  spawn/write (the R1 gate); a store connect records + overwrites while a keep
  connect writes nothing; spawn starts in `$HOME` and `cd`s to the deck folder with a
  sanitized env (no deck-injected `BASH_ENV`/etc.); playback of a recording with
  crafted reply sequences never reaches a shell (R2); a flagged element is withheld
  from export (placeholder, bytes absent) until the per-element opt-in, then exports;
  a clean export bakes an inert snapshot (no script/handlers/remote URLs); reaper
  kills the child on window-close.

## 9. Files touched (map)

- `src/types/presentation.ts` — the element type + recording types (`docs/LLM-EDITING.md`).
- `src/components/SlideElementRenderer.tsx` — parent-frame xterm (live), inert
  snapshot render (frozen), no PTY in the six frozen paths.
- `src/lib/terminalSnapshot.ts` (new) — serialize + allowlist + ANSI→inert-HTML.
- `src/lib/sanitizeHtml.ts` — reused as the converter/export backstop.
- `src/lib/terminalSecretScan.ts` (new) — heuristic secret detection driving the
  per-element export flag/gate (§5b).
- `src/store/presentation.ts` — recording state (store vs keep connect),
  capture-on-advance, playback mode, the per-element "allow export" flag.
- `src-tauri/src/pty.rs` (new) — PTY owner, sanitized spawn, reaper, `Mutex` handle.
- `src-tauri/src/lib.rs` — register the PTY commands.
- `src-tauri/capabilities/` — a dedicated PTY capability `windows:["main"]`; tighten
  the `default.json` `"*"` wildcard.
- `src/lib/exportCore.mjs` / print path — bake the inert snapshot; honor the §5b
  export gate (render the "withheld" placeholder for a flagged, not-opted-in element).
- `docs/ELEMENT-CHECKLIST.md` — the new element's row (PTY-in-exactly-one-path).

## 10. Future (not v1)

Named/parallel sessions; keystroke-timed typewriter playback; delta-compressed
recordings; a "safe demo" mode that records on the author's machine and ships
playback-only to recipients.
