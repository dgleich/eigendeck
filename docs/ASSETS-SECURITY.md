# Asset security & trust — design

Status: **design, not yet implemented** (agreed 2026-07-01). Companion to
[`ASSETS.md`](ASSETS.md), which is the design of how assets are stored, watched,
rendered, and updated. This document is the single source of truth for the *why*
and *rules* behind **when Eigendeck is allowed to read/watch an external file**,
and the **trust** model that gates it. `ASSETS.md` owns the mechanics of watching;
this file owns the security decision of *whether* a path may be watched at all.

## The threat

A `.eigendeck` is a SQLite file people **email and share**. An asset can carry an
`external_path` that Eigendeck reads and live-reloads from disk. A crafted or
round-tripped deck can point that path at a secret (`~/.ssh/id_rsa`), directly or
via a symlink; on open/reload Eigendeck would read it, **embed the bytes** into the
asset snapshot, and the secret then travels when the deck is re-shared. **The human
is the egress** — they re-share the deck (or, socially engineered, send it back).

**The read is the cut that matters.** If the unauthorized read never happens,
nothing enters the artifact to leak. So the design centers on *read
authorization*, not on egress filtering or on trusting the user to notice.

## Why the read — not the network — is the boundary (comparative)

**Beamer / local LaTeX.** LaTeX already has a read primitive in the document
language: `\input{~/.ssh/id_rsa}` / `\lstinputlisting` / `\read` pull an arbitrary
file's contents into the compiled PDF — **no shell-escape required** (that is a
documented attack class, "LaTeX injection"; see references). The classic
exfiltration: `\input` a secret in `\color{white}\tiny`, socially engineer *"can
you send me the compiled PDF?"*, recover the key from the invisible layer with
`pdftotext`. Both intuitive defenses fail — "pdflatex has no network" doesn't
matter because the human re-shares the PDF, and "you'd see it" fails because it's
white/tiny/off-page. Real-world Beamer is mostly safe only because the read is
**transient** (`\input` reads at compile time; the `.tex` *source* stays clean, so
re-sending source leaks nothing) and because the attack isn't commonly weaponized.

**How Eigendeck differs.**
- *Worse:* Eigendeck **persists** the read — it embeds the bytes into the asset
  snapshot, and the `.eigendeck` **is** the shared artifact. There is no clean
  "source vs. output" split; the output is the document.
- *Better:* a deck has **no read primitive**. A `.eigendeck` is pure data; it
  cannot `\input`. Reads happen only through app code (external-path resolution +
  the user's file dialog). LaTeX cannot remove `\input`; Eigendeck can simply refuse
  to auto-resolve a foreign deck's paths, leaving a received deck **zero** read
  capability.

**Overleaf (hosted LaTeX)** has the identical read capability but escapes it with a
different boundary: it doesn't run on your machine. Each compile is an ephemeral,
isolated container; even a malicious `\input` reaches only throwaway-container files
(no `~/.ssh/id_rsa` there). We can't borrow that — Eigendeck is a *local* app
reading the *user's own* disk — which is exactly why our boundary is
*read-authorization* (what may be reached) not *execution-isolation* (where code
runs).

**PowerPoint / Keynote** don't do live external links (media is embedded on
insert; linked/OLE objects are the known-malware analogue that embedding replaced).
Takeaway: for the large population who never link external files, the feature and
its security surface should be **completely invisible**.

## Core model

- **No bundle / package format.** Decks stay single `.eigendeck` files. The safety
  boundary is not a directory — it is **transparency + explicit approval**: nothing
  external is read or watched until the user has seen exactly what a deck touches
  and approved it.
- **Trust gates *watching only*.** The embedded snapshot **always renders**, so
  every deck opens fully regardless of trust. Untrusted just means "no live updates
  from disk." Trust decisions never block and never hide content.
- **Trust is a deck-level gate; watching lives under it.** A deck is *trusted*
  (created via File → New, or explicitly trusted) or *untrusted*. **Watching — and
  every disk read, continuous or one-shot — requires a trusted deck.** On an
  untrusted deck the watch toggle is disabled, nothing is read from disk, and adding
  an external asset neither watches nor trusts it. Three nested levels:
  **deck trust → watching on/off → per-path approval.**
- **realpath always applies**, trust or not. Every external reference is
  `realpath`-resolved; approval binds to the **resolved target**; a later swap to a
  different target fails to match and is not read.
- **Reads only ever happen through app code** (external-path resolution + the file
  dialog). A deck has no read primitive of its own, so denying a foreign deck
  auto-resolution leaves it with zero read capability.
- **Limited, transparent, low-nag UX.** Default to silence; interrupt only for
  genuinely new/deliberate situations; **no modal on open, ever**; approval is an
  informed one-off review of a visible list of exactly what is accessed; never train
  click-through (prompt fatigue is itself a vulnerability). Non-watchable targets are
  simply *Forbidden* — not offered as an approvable choice at all.

## Trust store

- **App-side ledger in appData**, *not in the deck*. Keyed by
  `(deck-token, resolved-path)`. `deck-token` = a random id stamped at create;
  survives file moves; a received deck's token isn't in your ledger → untrusted by
  default.
- **Trust attaches ONLY to File → New** (and only when global watching is on — off
  is the PowerPoint model, so trust is moot). **Save / Save-As of an untrusted
  (received) deck does not create trust** — persisting a received deck never
  launders it into trusted.
- **Trust has a 30-day TTL, from last open.** Opening a trusted deck refreshes the
  timer; a deck dormant 30+ days lapses on next open (**untrusted-by-TTL**). On
  lapse, approvals are **retained but inactive** so the prior state can be restored
  in one confirmation — distinct from **revoke**, which *removes* approvals. The TTL
  also bounds the copyable-token residual and forces periodic re-review.
- **HTML export is terminal.** Assets are inlined as base64 `data:` URLs, so no
  `external_path`, watching, or trust token survives an export. Any deck derived
  from exported HTML is untrusted by construction with nothing watched.
- **Optional hardening** (defense-in-depth vs *other apps*, not decks): HMAC ledger
  entries with a per-install key in the OS keychain, ACL-bound to the app's code
  signature; tampering can only ever downgrade an entry to untrusted (fail-safe).

## Watchable asset types — the 0th-order allowlist

Whether a resolved target may be watched **at all** is decided first, before trust
or approval, by an **asset-type allowlist** on the `realpath`-resolved target. A
target passes only if **both** hold:

1. **Allowed extension** — in the asset allowlist (images `png/jpg/gif/webp`,
   `svg`, `pdf`, video `mp4/webm/mov`, notebooks `ipynb`, demos `html`). The file dialog
   already filters to these; the same list is enforced when approving a received
   deck's paths. Secrets (`id_rsa`, `.env`, `.aws/credentials`, `.netrc`, keychains,
   shell history) fail here by construction (default-deny).
2. **Content must match the extension** — a `.png` that is really HTML or text is
   rejected. How "matches" is verified depends on who owns the format:
   - **Interchange formats we don't own** (png/jpg/gif/webp, pdf, mp4/webm/mov, svg,
     ipynb) → **native type identity**: magic bytes / structural parse (`<svg>`
     root; valid `nbformat` JSON). We can't require our own marker — these come from
     Illustrator, matplotlib, Jupyter, etc.
   - **Formats we own** (demos) → **an eigendeck signature**: a demo `.html` must
     carry `<!--eigendeck-demo-v1-->` **immediately after `<!DOCTYPE html>`** (a
     leading BOM/whitespace is tolerated; after-DOCTYPE keeps the document in
     standards mode in every load context). The marker is versioned and checked
     **fail-closed** — an unknown/newer version is "not a demo I can run," never
     assumed safe. Existing demos are re-stamped / rebuilt to carry it (an accepted
     lift). Full contract: [`DEMO_AUTHORING.md`](../DEMO_AUTHORING.md).

**Principle: for a format we *own*, require our own signature; for an *interchange*
format, use its native type identity.** Both checks run on the resolved target's
bytes, so a symlink/rename can't smuggle a secret under an allowed name
(`a.png → id_rsa` resolves to `id_rsa` → no allowed extension; a genuinely
`.png`-named text file fails the content check).

**The demo marker is a demo-ingestion invariant, not just a watch gate.** The same
check runs *wherever HTML enters the demo pipeline*, via one shared checker:
- **Adding** a demo — refuse an unmarked `.html`; you cannot turn an arbitrary web
  page into a demo, it must be authored as an eigendeck demo.
- **Mounting** — re-check demo bytes before they are mounted/rendered, so a deck can
  never render non-demo HTML as a demo.
- **Watching** — the same check on the resolved file on disk.

Invariant: *every demo asset is a marked eigendeck demo; unmarked HTML never becomes
a demo.* What this does and doesn't buy: on the **read/watch** path (checking the
resolved target) it delivers the exfil protection — a victim's non-demo files lack
the marker, so a shared deck can't point a "demo" at them. At **add/mount** it is
format integrity — only intentional demos are treated as demos. It does **not** stop
a hostile deck author from shipping a *marked* malicious demo; hostile demo *code*
is contained by the iframe sandbox + CSP (a separate design), not by the marker.

A target that fails the allowlist is **Forbidden** — not a model state, a
precondition that trumps everything: never read/watched/approvable. It only
surfaces when tripped (explicit reload, or selecting the element), framed
**destination-forward** ("would read `~/.ssh/id_rsa` — not a watchable asset
type"), never behind the innocuous link name.

**What the allowlist does NOT catch — the residual for approval + realpath
transparency:** the victim's *own genuine* allowed-type files that happen to be
sensitive (`tax.pdf`, `passport.jpg`, a private demo). Those pass the type gate;
the user declines them by reading the resolved path in the approval list.

## Path states (for everything not Forbidden)

- **Approved** — `(deck, resolved-target)` is in the ledger. Green + watched when
  watching is on; reloadable on demand otherwise.
- **Eligible** — referenced but not approved. Never read or watched until approved.

## Scoping — who ever sees any of this

- **Asset-watching is ON by default**, but the security UX is gated on **the deck
  actually having external paths**, not on the global toggle. A fully-embedded
  (PowerPoint-style) deck never surfaces any of it.
- Untrusted deck with external paths → **silent**: snapshot renders, nothing
  watched, no nag; the user opts into trust deliberately.

## State model

Three booleans (Forbidden already excluded): **deck trusted?**, **watching on?**
(= global AND per-deck AND the asset's own "watch this file" toggle; forced off
while untrusted), **path approved?**.

### Invariants
1. Snapshot always renders — nothing hides content.
2. Any disk access (watch OR one-shot reload) requires a trusted deck.
3. Continuous watch happens exactly when: trusted AND approved AND watching on.
4. One-shot reload happens exactly when: trusted AND approved (independent of the
   watch toggles).
5. Approval binds to the resolved target; if the target later changes, the entry
   reverts to Eligible and watching stops.
6. Trust is stored per `(deck-token, resolved-target)`; the deck-level trusted flag
   unlocks watching.

### The five states
- **U** — untrusted (watching effectively off; no *active* approvals). Two origins:
  **U-new** (never trusted / revoked → re-trust = approve from scratch) and
  **U-ttl** (lapsed by TTL → approvals retained-inactive → re-trust *restores* them
  in one confirmation).
- **T-Woff-E / T-Woff-A** — trusted, watching off, path Eligible / Approved.
- **T-Won-E / T-Won-A** — trusted, watching on, path Eligible / Approved.

("Watching on" is the effective per-path setting; an asset whose own toggle is off
behaves as its T-Woff-\* row even while the deck watches.)

### Behavior per read/render event
- **U** — open: snapshot only, watch toggle disabled. Reload: **refused** ("trust
  the deck first").
- **T-Woff-E** — open: snapshot; inspector "eligible — approve". Reload: flag →
  approve → read once.
- **T-Woff-A** — open: snapshot. Reload: read once (refresh).
- **T-Won-E** — open: snapshot, not watched; if newly appeared → persistent "N new
  linked files aren't watched — Review" toast; inspector "eligible — approve".
  Reload: flag → approve → read + start watching.
- **T-Won-A** — open: snapshot renders; path handed to the watcher (`ASSETS.md`).
  Reload: read now (stays watched).

**Out of scope here — the watcher itself.** Once a path is Approved and watching is
on, the "file changed on disk → reload" behavior is the *watcher's* design
(`ASSETS.md`). This document governs only *whether* a path is watched.

### Add external asset (new path; lands per deck state)
- Untrusted deck → embedded + path recorded; not watched, not trusted.
- Trusted, watching off → Approved, unwatched (T-Woff-A).
- Trusted, watching on → Approved + watched (T-Won-A).
- Any case: a Forbidden resolved target → Forbidden.

### Transitions
- **File → New** → Trusted (if global watching on); added links Approved.
- **Save / Save-As of an untrusted deck** → stays Untrusted (no laundering).
- **Open a received deck** → Untrusted (U).
- **Open a trusted deck** (token in ledger, TTL not lapsed) → Trusted; TTL
  refreshed; paths resume stored state; a path new since last-trust is Eligible
  (surfaces per T-Won-E).
- **Trust a received deck** (Security window: review + approve; "trust folder X",
  capped per action) → Trusted; reviewed allowed paths Approved; watch toggle
  unlocks.
- **Trust TTL lapses** (open 30+ days later) → U-ttl; approvals retained-inactive;
  non-blocking toast.
- **Re-confirm after TTL lapse** → one confirmation restores the prior approvals
  (still a review; excludes now-Forbidden/changed targets); never automatic on open.
- **Revoke trust** → Untrusted (U-new); approvals **removed**.
- **Toggle watching** (trusted only) → T-Woff-\* ↔ T-Won-\*.
- **Approve a path** → T-Woff-E → T-Woff-A, or T-Won-E → T-Won-A (begins watching).
- **Resolved target of an Approved path changes** → reverts to Eligible (or
  Forbidden if now sensitive); watching stops; resurfaces for re-approval.

## Surfaces

**Security window (deck-wide, own non-modal window).** Explainer; a list of every
external path with the path *as referenced*, its *resolved realpath target*, where
it's used, and its state (approved-green / eligible / Forbidden). Existence info is
shown only for eligible in-policy paths (Forbidden rows show the reason, not
exists/missing — this avoids a filesystem-recon oracle). Actions: approve per file;
"Trust folder X" bulk-approve of the *current* eligible paths (capped per action);
Forbidden rows have no approve action; approved rows go green and stay. For a
**U-ttl** deck it shows the previously-approved paths "paused (trust expired)" with
a single **Re-confirm to resume watching** restore.

**Element inspector (per-element, AssetSection).** For a selected linked element,
shows that asset's status: watched (green) / eligible / **Forbidden** (with the
destination-forward reason) — so the user learns "this linked file is Forbidden"
without opening the deck-wide window.

## Residuals / non-goals

- **Human social engineering** (relocate picker: "point it here") — not eliminable;
  mitigated by picker friction + the asset-type allowlist (a non-asset target is
  Forbidden and can't be watched even if selected).
- **Screenshot oracle** — accepted overt-only: we own the UI (no hidden channel),
  it needs active SE + a visible send, and it isn't the white-text class. Uniform
  rendering of unresolved links keeps existence out of the rendered slide.
- **Co-resident malicious app** (same OS user) — out of scope; already outranks any
  trust store.
- **Copyable-token transplant** — the `deck-token` lives in the deck, so an attacker
  who obtains a deck you trusted could stamp its token into a hostile deck. Accepted
  **low**: it can only exercise *already-approved* paths (cannot approve anything
  new), requires obtaining a trusted deck *and* getting you to open the hostile deck
  *and* re-share it, and is **bounded by the 30-day TTL**. Same standing-grant
  property as watching itself; not worth a content-hash trust-anchor redesign.
- **Hardlinks / bind mounts** — out of scope: unlike symlinks (which travel in a
  tar/zip and are created on extraction), a hardlink/bind-mount to *your* secret
  can't be transmitted in an archive; creating one needs pre-existing local FS
  access, at which point the attacker can read the file without a deck. The
  transmittable link threats are **symlinks and plain path strings**, handled by
  realpath + the allowlist.

## To decide later (wordsmithing / tuning)

- Copy for the explainer, toast, and Forbidden-reason strings.
- Final name for "Forbidden" (vs "Off-limits" / "Denied").
- Allowlist contents (extensions + per-format content checks / the demo marker),
  and whether to layer a sensitive-path denylist on top as extra defense.
- The per-action trust cap number.
- Toast dismissal memory (session vs "don't ask again for this deck").
- Whether the inspector offers inline approve or always routes to the window.

## References

- PayloadsAllTheThings — *LaTeX Injection*:
  https://swisskyrepo.github.io/PayloadsAllTheThings/LaTeX%20Injection/
- *Hacking with LaTeX* (0day.work): https://0day.work/hacking-with-latex/
- Lacombe et al., *"Can You Accept LaTeX Files from Strangers? Ten Years Later"*
  (arXiv:2102.00856): https://arxiv.org/abs/2102.00856
- Overleaf shell-escape posture: https://github.com/overleaf/overleaf/issues/217
