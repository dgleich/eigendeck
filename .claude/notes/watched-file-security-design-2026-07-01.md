# Watched-file security & trust — design

Status: design (agreed in brainstorm 2026-07-01). Not yet implemented.
**Promoted to the canonical doc `/work/docs/ASSETS-SECURITY.md` — edit that one
going forward; this note is the working history.**
Related: `security-audit-2026-07-01.md` (PATH-access findings),
`security-brainstorm-2026-07-01/` (options menu, esp. D/F/G).

## Problem

A `.eigendeck` is an untrusted file people share. Assets can carry an
`external_path` that Eigendeck reads/watches from disk (live-reload). A crafted
or round-tripped deck can point that path at a secret (`~/.ssh/id_rsa`), directly
or via a symlink; on open/reload Eigendeck reads it, **embeds the bytes** into the
asset snapshot, and the secret then travels when the deck is re-shared — the human
is the egress. Reading itself is the cut that matters: if the unauthorized read
never happens, nothing enters the artifact to leak. The *Comparative analysis:
Beamer / LaTeX* section below explains why the read — not the network — is the
load-bearing boundary.

## Comparative analysis

How the neighbouring presentation/document tools handle (or dodge) this same
risk, and what Eigendeck should take from each.

### Beamer / local LaTeX

Beamer is the closest yardstick: emailing a `.tex` to a colleague, getting an
edited version back, and compiling it is a workflow academics already trust. It has
the *same class* of risk, so it calibrates both what is tolerable and where
Eigendeck must differ.

**LaTeX can already read your secrets — the read primitive is in the document
language.** `\input{~/.ssh/id_rsa}` (or `\lstinputlisting` / `verbatim`'s
`\verbatiminput`) pulls an arbitrary file's contents into the compiled document.
No shell-escape is required for this. (`\write18`, i.e. shell-escape, is full
command execution — but it is disabled by default, so it is not the concern here.)

**The white-text exfiltration.** An attacker sends a Beamer deck that does
`\input{~/.ssh/id_rsa}` inside `\color{white}\tiny{...}` (or off-slide / 0pt), so
the key is typeset **invisibly** into the PDF. Then a small social-engineering
nudge — *"I can't get TeX working on my laptop, could you send me the compiled
PDF?"* — and the helpful colleague compiles and returns it. `pdftotext` recovers
the private key from the invisible layer. Both intuitive defenses fail: "pdflatex
has no network" doesn't matter because **the human re-shares the artifact** (the
human is the egress), and "you'd notice it on a slide" fails because it is white /
tiny / off-page.

**Why real-world Beamer is nonetheless mostly safe.** Two reasons, neither of
which is "it can't read":
1. **The read is transient.** `\input` reads at *compile* time; the `.tex` source
   only ever contains the *directive*, not the file's contents. So re-sending the
   **source** leaks nothing — only the compiled **PDF** carries the secret.
2. The attack is simply not commonly weaponized.

**How Eigendeck differs — worse on one axis, better on another.**
- **Worse: Eigendeck persists the read.** It *embeds* the read bytes into the
  asset snapshot, and the `.eigendeck` is itself the shared artifact. So a read
  lands in the very file people re-share — unlike LaTeX, where the read is
  transient and the shared source stays clean. Eigendeck has no "clean source vs.
  dirty output" split; the output *is* the document.
- **Better: a deck has no read primitive.** A `.eigendeck` is pure data; it cannot
  `\input`. Reads happen *only* through app code (external-path resolution + the
  user's file dialog). LaTeX cannot remove `\input` without ceasing to be LaTeX;
  Eigendeck can simply **refuse to auto-resolve a foreign deck's paths**, leaving a
  received deck with *zero* read capability.

**Consequences for this design.**
- Because we can rely on neither "no egress" (the human re-shares) nor "you'd see
  it" (white-text / and our persist-then-reshare path), the load-bearing cut must
  be at the **read**: prevent the unauthorized read so nothing ever enters the
  artifact. Eigendeck can make that cut cleanly — no deck-level read primitive +
  explicit approval + `realpath`/destination transparency — which is why this
  design centers on read-authorization rather than egress filtering or on trusting
  the human to notice.
- The white-text lesson also shapes our UI: LaTeX let the *author* control
  rendering and hide the payload; **we own the renderer**, so the "what is
  accessed" surface (the approval list and the inspector) shows **resolved targets
  in plain sight** and never presents accessed paths invisibly. There is no
  author-controlled hidden layer in our approval flow.

That LaTeX can read arbitrary files (`\input`, `\lstinputlisting`, the `\read`
primitive) with **no shell-escape required**, and that this is used to exfiltrate
files such as `/etc/passwd` into the rendered PDF, is a documented attack class
("LaTeX injection") — see references below.

### Overleaf (hosted LaTeX)

Overleaf faces the *identical* LaTeX file-read capability, but escapes the threat
with a completely different boundary: it **doesn't run on your machine.** Each
compile happens in an **ephemeral, isolated container** on Overleaf's servers, and
`\write18` (shell-escape) is disabled in the Community Edition. So even though a
malicious `.tex` can still `\input` arbitrary files, the only files reachable are
those *inside that throwaway container* — there is no `~/.ssh/id_rsa` on a fresh
build container, and the container is destroyed after the compile. The lesson for
Eigendeck: Overleaf is safe because the read has **nothing valuable to reach**, via
a server-side sandbox. Eigendeck is a *local* app reading the *user's own* disk, so
we cannot borrow that boundary — which is exactly why our boundary has to be
read-authorization (what may be reached) rather than execution-isolation (where the
code runs).

### PowerPoint / Keynote

Simple case: they **don't do file-watching / live external links** the way we're
contemplating. Media is imported and embedded into the document; there is no
persistent "re-read this path from disk on open" relationship for a shared deck to
weaponise. (PowerPoint's *linked* objects and OLE are the nearest analogue and are
a known malware vector, which is precisely why the modern default is embed-on-
insert.) The takeaway: for the large population of users who never link external
files — importers coming from PowerPoint/Keynote — the feature and its security
surface should be **completely invisible** (this is why the UX is gated on a deck
actually having external paths, not on the global toggle).

### References

Links verified 2026-07-01.

- PayloadsAllTheThings — *LaTeX Injection* (arbitrary file read via `\input`,
  `\lstinputlisting`, `\read`; exfil into the PDF):
  https://swisskyrepo.github.io/PayloadsAllTheThings/LaTeX%20Injection/
- *Hacking with LaTeX* (0day.work) — read primitives (`\input`, `\newread`/
  `\openin`) and shell-escape modes: https://0day.work/hacking-with-latex/
- Lacombe, Masalygina, Tahiri, Adam & Lauradoux — *"Can You Accept LaTeX Files
  from Strangers? Ten Years Later"* (arXiv:2102.00856): malicious LaTeX that hides
  harvested system data in the PDF, plus an evaluation of online-editor (Overleaf,
  etc.) sandbox defenses. https://arxiv.org/abs/2102.00856
- Overleaf — shell-escape disabled by default in the Community Edition (`minted`
  requires `-shell-escape`), i.e. its sandbox posture:
  https://github.com/overleaf/overleaf/issues/217

## Core model

**No bundle / package format.** Decks stay single `.eigendeck` files that may
reference external paths. The safety boundary is NOT a directory — it is
**transparency + explicit approval**: nothing external is read or watched until
the user has seen exactly what a deck touches and approved it.

**Trust gates *watching only*.** The embedded snapshot **always renders**, so
every deck opens fully regardless of trust. Untrusted just means "no live updates
from disk." Trust decisions are therefore never blocking and never hide content.

**Trust is a deck-level gate; watching lives under it.** A deck is either
*trusted* (you authored it, or you explicitly trusted it) or *untrusted*.
**Watching — and every disk read, continuous or one-shot — requires a trusted
deck.** On an untrusted deck the watch toggle is disabled, nothing is read from
disk, and *adding a new external asset neither watches nor trusts it*. Per-path
approval (approved / eligible; Forbidden is the 0th-order exclusion) only exists
*inside* a trusted deck. So
the model has three nested levels: **deck trust → watching on/off → per-path
security** (enumerated exhaustively in *State model* below).

**Containment/realpath always applies**, trust or not. Every external reference is
`realpath`-resolved; approval binds to the **resolved target**, and reads are
performed against that resolved target (no-follow on the final component / re-stat
to avoid TOCTOU). A post-approval swap to a different target fails to match and is
not read.

**Reads only ever happen through app code** (external_path resolution + the user's
file dialog). A deck has no read primitive of its own (unlike LaTeX `\input`), so
denying a foreign deck auto-resolution means it has zero read capability.

**Limited, transparent, low-nag UX.** The security surface must be *minimal and
honest*, and it must never train users to reflexively approve. Concretely:
- **Minimal nagging.** Default to silence — untrusted decks render from the
  embedded snapshot and say nothing. Interrupt only for genuinely new or
  deliberate situations (a trusted deck gaining a new link; a user explicitly
  turning on watching). No modal on open, ever.
- **Transparent.** Approval is an informed, one-off review of a **visible list of
  exactly what is accessed** (resolved targets in plain sight — see the white-text
  lesson below), not a yes/no popup with no detail.
- **Don't train click-through.** Prompt fatigue is itself a vulnerability: a
  security dialog users rubber-stamp is worse than none. So there is no recurring
  approval modal; approval is a deliberate, infrequent act, and dangerous targets
  are simply **Forbidden** (not offered as an approvable choice at all).

## Trust store

- App-side ledger in appData (Tauri), **not in the deck**. Keyed by
  `(deck-token, resolved-path)` pairs. `deck-token` = a random id stamped at
  create/save; a received deck's token isn't in your ledger → untrusted by default;
  survives file moves.
- **Creating a new deck (File → New) trusts it — but only when global watching is
  on.** A deck you create from scratch is trusted (so links you add are approved
  immediately) **only if the global watching default is on**. With global watching
  off (the PowerPoint model) it establishes no trust — there is nothing to watch, so
  it's moot. **Trust attaches ONLY to File → New.** Saving or Save-As of an
  *untrusted* (received) deck does **not** create trust — persisting a deck that came
  from elsewhere never launders it into trusted. Adding a link to an untrusted deck
  likewise does not trust or watch it; the deck must be trusted first (per the
  deck-level gate above).
- **Trust has a 30-day TTL, measured from last open.** Opening a trusted deck
  refreshes the timer, so an actively-used deck never lapses; a deck dormant for 30+
  days lapses on next open. When it lapses the deck becomes **untrusted-by-TTL**,
  but its approvals are **retained-but-inactive** (no reads happen while untrusted)
  so the prior state can be restored in one confirmation (see the state model).
  This is distinct from an explicit **revoke**, which *removes* approvals (re-trust
  = start over). The TTL also bounds the copyable-token residual (below) and forces
  a periodic re-review of what's watched.
- **HTML export is terminal.** Assets are inlined as base64 `data:` URLs, so no
  `external_path`, watching, or trust token survives an export. A deck derived from
  exported HTML is therefore untrusted by construction with nothing watched — the
  safe outcome.
- Optional hardening (defense-in-depth vs *other apps*, not decks): HMAC entries
  with a per-install key in the OS keychain, ACL-bound to the app's code signature.
  Tampering can only ever **downgrade** an entry to untrusted (fail-safe), never
  silently escalate.

## Watchable asset types — the 0th-order allowlist

Whether a resolved target may be watched *at all* is decided FIRST, before trust or
approval, by an **asset-type allowlist** applied to the `realpath`-resolved target.
A target passes only if **both** hold:

1. **Allowed extension.** The resolved target's extension is in the asset allowlist
   (images `png/jpg/gif/webp`, `svg`, `pdf`, video `mp4/webm`, notebooks `ipynb`,
   demos `html`). The add-asset file dialog already filters to these; the *same*
   list is enforced when approving a received deck's paths. Everything an attacker
   wants — `id_rsa` (no extension), `.env`, `.aws/credentials`, `.netrc`, keychains,
   shell history — fails here by construction (default-deny).
2. **Content must match the extension.** The bytes must actually be the type the
   extension claims, so a `.png` that is really HTML or a text secret is rejected.
   How "matches" is verified depends on who owns the format:
   - **Interchange formats we don't own** (png/jpg/gif/webp, pdf, mp4/webm, svg,
     ipynb) → **native type identity**: magic bytes (PNG/JPEG/…, `%PDF`, container
     magic) or structural parse (`<svg>` root; valid `nbformat` JSON). We can't
     require our own marker here — these come from Illustrator, matplotlib, Jupyter,
     etc.
   - **Formats we own** (demos) → **an eigendeck signature**: a demo `.html` must
     begin (first non-whitespace bytes) with `<!--eigendeck-demo-v1-->`. We define
     the demo format, so we can demand the marker — it upgrades otherwise-permissive
     HTML (anything "parses" as HTML) to a content-verifiable type. Existing demos
     are re-stamped / rebuilt to carry it (an accepted implementation lift).

**Principle:** for a format *we own*, require *our own* signature; for an
*interchange* format, use its *native* type identity. Both checks run on the
resolved target's bytes, so a symlink or rename can't smuggle a secret in under an
allowed name (`a.png → id_rsa` resolves to `id_rsa` → no allowed extension; a
genuinely `.png`-named text file fails the content check).

A target that fails the allowlist is **Forbidden**: **not a state in the model
below** — a precondition that trumps everything. Never read, never watched, never
approvable, regardless of trust/watching/approval. *A watched (or approvable) path
is never a Forbidden one.* It only **surfaces when tripped** — an explicit reload,
or selecting the element that uses it — framed **destination-forward** ("would read
`~/.ssh/id_rsa` — not a watchable asset type"), never behind the innocuous link
name. (Name "Forbidden" is a placeholder — "Off-limits" / "Not-a-watchable-type".)

**What the allowlist does NOT catch — the residual for approval + realpath
transparency:** the victim's *own genuine* allowed-type files that happen to be
sensitive (`tax.pdf`, `passport.jpg`, an actual eigendeck demo containing something
private). Those legitimately pass the type gate; the user declines them by reading
the resolved path in the approval list.

## The two path states (for everything not Forbidden)

- **Approved** — this `(deck, resolved-target)` is in the trust ledger. Shown green
  and watched when watching is on; reloadable on demand otherwise.
- **Eligible** — referenced but not approved. Never read or watched until approved.

## Scoping — who ever sees any of this

- **Asset-watching is ON by default**, BUT the security UX is gated on **the deck
  actually having external paths**, not on the global toggle. A fully-embedded
  (PowerPoint-style) deck has no external paths → the user never encounters any of
  it.
- A deck/asset with watching turned off → silent.
- Untrusted deck with external paths → **silent**: snapshot renders, nothing is
  watched, no nag. The user opts into trust deliberately.

## State model — full case enumeration

Forbidden paths (above) are already excluded. Everything else is enumerated here
as three booleans crossed with the events that can occur.

### The events (complete set)
Read/render events where a security decision is made:
- **Open / render** — the deck loads or a slide paints; each path's state is
  evaluated, and watchable (T-Won-A) paths are handed to the watcher.
- **Reload from disk** — the user clicks reload on a specific asset (explicit,
  one-shot).
- **Add external asset** — the user picks a file, creating a new external path.

Control actions (change state; no read of their own):
- **Toggle deck watching** on/off · **Toggle a single asset's "watch this file"**
  on/off · **Trust deck** / **Revoke trust** · **Approve a path**.

**Out of scope — the watcher itself.** Once a path is Approved and watching is on
(state T-Won-A), the ongoing "file changed on disk → reload" behavior belongs to the
*watcher* design (`docs/ASSETS.md`), not here. This document governs only *whether*
a path is watched (the security gate), not what watching then does.

### The axes (three booleans; Forbidden already excluded)
- **Deck trusted?** — created via File → New, or explicitly trusted. The master gate.
- **Watching on?** — the effective per-path watch setting = global watching AND
  per-deck watching AND the asset's own "watch this file" toggle (all must be on).
  Forced Off while the deck is untrusted.
- **Path approved?** — this `(deck, resolved-target)` is in the trust ledger.

Deck-trust is the master: while a deck is untrusted, watching is effectively Off
and there are no approvals (revoking trust removes them — see below), so the
untrusted case collapses to one behavior regardless of the other bits (state **U**
below).

### Invariants
1. **Snapshot always renders** — nothing here hides content.
2. **Any disk access (watch OR one-shot reload) requires a trusted deck.** Untrusted
   means zero disk reads.
3. **Continuous watch happens exactly when:** Deck trusted AND Path approved AND
   watching on — where "watching on" = global watching AND per-deck watching AND
   the asset's own "watch this file" toggle, all on.
4. **One-shot reload happens exactly when:** Deck trusted AND Path approved
   (independent of the watch toggles — you can reload a file you don't continuously
   watch).
5. **Approval binds to the resolved target**; if the target later changes
   (symlink/path swap), the entry reverts to Eligible and watching stops.
6. **Trust is stored per `(deck-token, resolved-target)`**; the deck-level trusted
   flag is what unlocks watching.

### On revoke and TTL expiry (active approvals exist only under trust)
Two different ways a deck leaves trusted, with different treatment of approvals:
- **Explicit revoke** ("stop trusting / stop watching this deck") → untrusted, and
  approvals are **removed** from the ledger. Re-trusting means approving from
  scratch. This is the user's deliberate "I don't trust this" signal.
- **TTL expiry** (30 days since last open) → **untrusted-by-TTL**, and approvals are
  **retained but inactive** — they authorize no reads while untrusted, but are kept
  so the user can restore the prior state in one confirmation. Expiry is staleness,
  not distrust, so the prior intent is preserved.

Either way, **while untrusted no reads happen** (invariant 2). So there is never an
*active* approval on an untrusted deck; a TTL-lapsed deck carries *inactive*
(dormant) approvals that do nothing until re-confirmed. (The stored *watching*
preference may still read On while untrusted, but *effective* watching is Off.)

### The five states (a non-Forbidden path is always in exactly one)
- **U** — Deck untrusted. (Watching effectively off; no *active* approvals.) Two
  origins, identical behavior but different re-trust UX:
  - **U-new** — never trusted (received deck, or revoked): no retained approvals →
    re-trust means review + approve from scratch.
  - **U-ttl** — was trusted, lapsed by the 30-day TTL: approvals retained-but-
    inactive → re-trust *restores* them in one confirmation (still shows the paths).
- **T-Woff-E** — Trusted, watching off, path Eligible.
- **T-Woff-A** — Trusted, watching off, path Approved.
- **T-Won-E** — Trusted, watching on, path Eligible.
- **T-Won-A** — Trusted, watching on, path Approved.

*"Watching on" is the effective per-path setting (deck watching AND the asset's own
"watch this file" toggle). An asset whose own toggle is off behaves as its
**T-Woff-\*** row even while the deck is watching.*

### Behavior for each state, per read/render event

- **U — untrusted**
  - *Open / render:* snapshot only; watch toggle disabled.
  - *Reload from disk:* **refused** — "trust the deck first" (links to the Security
    window).
- **T-Woff-E — trusted, watching off, Eligible**
  - *Open / render:* snapshot only; inspector shows "eligible — approve".
  - *Reload from disk:* flag → approve → read once.
- **T-Woff-A — trusted, watching off, Approved**
  - *Open / render:* snapshot only.
  - *Reload from disk:* read once (refresh).
- **T-Won-E — trusted, watching on, Eligible**
  - *Open / render:* snapshot only, not watched; if the path newly appeared this
    open → persistent toast "N new linked files aren't watched — Review"; inspector
    shows "eligible — approve".
  - *Reload from disk:* flag → approve → read + start watching.
- **T-Won-A — trusted, watching on, Approved**
  - *Open / render:* snapshot renders; path is watchable → handed to the watcher
    (`docs/ASSETS.md`).
  - *Reload from disk:* read now (stays watched).

### The "Add external asset" event (creates a NEW path; lands per deck state)
- **Untrusted deck** → bytes embedded + `external_path` recorded; **not watched,
  not trusted**; deck stays untrusted.
- **Trusted, watching off** → **Approved** (you picked it in a trusted deck),
  unwatched because watching is off (→ state T-Woff-A).
- **Trusted, watching on** → **Approved + watched** immediately (→ state T-Won-A).
- In every case, if the picked file's resolved target is Forbidden → Forbidden
  (0th-order rule; not watched, not approvable).

### Control actions (transitions between states)
- **Create a new deck (File → New)** → deck becomes Trusted **only if the global
  watching default is on** at that time; links you add are then Approved. (Global
  watching off = PowerPoint model = no trust; nothing to watch.)
- **Save / Save-As of an untrusted (received) deck** → stays **Untrusted**. Trust
  attaches only to File → New; persisting a received deck under a new name/path does
  NOT launder it into trusted.
- **Open a received deck** → deck is Untrusted → state **U**.
- **Open a trusted deck** (one you authored, or previously trusted — its token is in
  the ledger, TTL not lapsed) → Trusted; the TTL clock is **refreshed to now**; each
  path resumes its stored state: Approved paths → T-Woff-A / T-Won-A per the watch
  setting, everything else Eligible. A path that appeared since the deck was last
  trusted is Eligible (not auto-approved) and surfaces per T-Won-E (the "new linked
  files" toast).
- **Trust a received deck** (Security window: review + approve current paths /
  "trust folder X", capped per action) → Trusted; reviewed allowed paths become
  Approved; the watch toggle unlocks. (Forbidden targets are shown but never
  approvable.)
- **Trust TTL lapses** (open a deck 30+ days after its last open) → **U-ttl**:
  untrusted, effective watching off, but the deck's approvals are **retained,
  inactive**. Surfaced by a non-blocking toast ("Watching paused — 30 days since you
  last opened this deck. Re-confirm to resume.").
- **Re-confirm after TTL lapse** → Security window shows the previously-approved
  paths; **one confirmation restores them all** (still a review, just not a re-entry)
  → back to Trusted, TTL refreshed. Easy to get back, but a deliberate act — never
  automatic on open. (Any path now resolving to Forbidden / a changed target is
  shown and left out of the restore.)
- **Revoke deck trust / "stop watching this deck"** → back to Untrusted (**U-new**);
  effective watching off; **the deck's stored approvals are removed** from the ledger
  (re-trusting later requires approving from scratch).
- **Toggle watching** (trusted only) → moves T-Woff-\* ↔ T-Won-\*.
- **Approve a path** (from toast / inspector / Security window) → T-Woff-E → T-Woff-A,
  or T-Won-E → T-Won-A (the latter begins watching).
- **Resolved target of an Approved path changes** (symlink/path swap on a
  round-trip) → reverts to Eligible, or to Forbidden if the new target is sensitive;
  watching stops; resurfaces for re-approval.

## Surfaces

### 1. Security window (deck-wide) — own non-modal window
A dedicated non-modal Tauri webview window (feasible; the app already runs
presenter/projector windows). Per-deck. Contents:
- Short plain-language explainer of the risk + why approval is needed.
- List of every external path the deck references, each row showing:
  - the path **as referenced** and its **resolved realpath target**;
  - **where it's used** (slide / element);
  - **existence info only for eligible in-policy paths**; Forbidden rows show the
    reason (destination-forward) instead of exists/missing (avoids turning the list
    into a filesystem-recon oracle for the attacker-chosen paths — accepted residual
    is overt-only, since we own the UI and there is no hidden channel);
  - **state** (approved-green / eligible / Forbidden).
- Actions: approve per file; **"Trust folder X"** = bulk-approve the *current*
  listed eligible paths under X (capped per action — no thousand-file one-click;
  an over-cap set is itself a signal). Forbidden rows have **no approve action**.
- Approved rows go **green and stay** (not removed).
- **TTL-lapsed deck (U-ttl):** the window shows the previously-approved paths marked
  "paused (trust expired)" with a single **"Re-confirm to resume watching"** action
  that restores them all at once — a one-click review, not a re-entry. Any path now
  Forbidden or pointing at a changed target is shown and excluded from the restore.

### 2. Element inspector (per-element) — AssetSection
When an element with an external/linked asset is selected, its inspector shows the
**per-element status of that asset's path**: watched (green) / eligible (with an
approve affordance or link to the Security window) / **Forbidden** (with the
destination-forward reason). This is where a user selecting a specific element
learns "this linked file is Forbidden by security," rather than having to open the
deck-wide window. Extends the existing AssetSection (linked-path / reload /
auto-reload UI).

## Non-goals / residual risks

- **Human social engineering** (the relocate file-picker: "point it at this file")
  — not eliminable; mitigated by picker friction (must navigate to + select the
  secret past hidden-file defaults) and the asset-type allowlist (a non-asset target
  like `~/.ssh/id_rsa` is Forbidden and can't be watched even if selected).
- **Screenshot oracle** (user sends a screenshot revealing which attacker-chosen
  paths exist) — accepted as overt-only: we control the UI so there is no hidden
  channel, it requires active SE + a visible send, and it is not the white-text
  class. Uniform rendering of unresolved links keeps existence out of the rendered
  slide.
- **Co-resident malicious app** running as the same OS user — out of scope; it
  already outranks anything our trust store can defend.
- **Copyable-token transplant** — the `deck-token` lives in the deck, so an attacker
  who obtains a deck you trusted could stamp its token into a hostile deck. Accepted
  as **low**: the transplant can only exercise **already-approved paths** (it cannot
  approve anything new), it additionally requires the attacker to obtain a trusted
  deck *and* get you to open the hostile deck *and* re-share it (the human is the
  egress), and it is **bounded by the 30-day TTL** — after lapse, resuming requires a
  deliberate re-confirm that shows the paths. It is the same standing-grant property
  as watching itself (an approval authorizes a path's current *and future* content).
  Not worth a content-hash trust-anchor redesign; the TTL is the mitigation.
- **Hardlinks / bind mounts** — out of scope: unlike symlinks (which travel in a
  tar/zip and are created on extraction), a hardlink or bind mount to *your* secret
  can't be transmitted in an archive — creating one needs pre-existing local
  filesystem access, at which point the attacker can already read the file without a
  deck. The transmittable link threat is **symlinks** (and plain path strings),
  handled by realpath + the content-type allowlist.

## To decide later (wordsmithing / tuning)

- Exact copy for the explainer, toast, and Forbidden-reason strings.
- Final name for "Forbidden" (vs "Off-limits" / "Denied").
- The asset-type allowlist contents (extensions + per-format content checks / the
  `<!--eigendeck-demo-v1-->` marker), and whether to layer any sensitive-path
  denylist on top as extra defense.
- The per-action trust cap number.
- Toast dismissal memory (session vs "don't ask again for this deck").
- Whether the inspector offers inline approve or always routes to the Security
  window.
