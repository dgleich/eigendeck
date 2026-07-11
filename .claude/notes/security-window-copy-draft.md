# Security window — copy draft (v1)

Draft of the full "Security & linked files" window, enumerating every deck state and
row state, per your directions. Edit inline; ping me and I'll implement against the
ledger provenance (trustedAt / trustReason / per-approval at+reason) that's now landed.

Conventions:
- `{X}` = runtime value.
- **Resolved-target line** is shown ONLY when the resolved realpath differs from the
  authored reference (i.e. a symlink or `../..` traversal) — the suspicious case. For a
  normal in-folder link we show just the reference name.
- Provenance from the ledger: each approval has `{when}` + `{how}` (added / relocated /
  approved here / folder-approved); the deck has `{trustedWhen}` + `{trustHow}`.

---

## 0. Window chrome (always)

**Title:** `Security & linked files`
_(kept broad — may later cover HTML/JS demo-sandbox settings too)_

**One-line explainer (under the title, always):**
> Eigendeck can keep a deck's images, demos, and notebooks **linked** to files on your
> computer so they update as you edit them. That means reading those files. So
> Eigendeck only does it for decks you trust, and only for files you approve.
> When you add a file to a deck you already trust, it's approved automatically. You only
> approve files one-by-one for decks you received from someone else.

**Reassurance line (always, emphasized!):**
> You never need to trust a deck just to view it. Every asset is already embedded. Trust
> only affects whether linked files stay **live**.

---

## 1. Deck-status band — branches by scenario

Exactly one of these renders at the top, with the primary action. `{approved}` /
`{watched}` / `{eligible}` / `{blocked}` counts come from the current scan.

### CASE A — Fully embedded (no external links)
> **Nothing to manage.** This deck is fully self-contained — nothing links to files on
> your computer, so there's nothing to trust or watch.

_No actions. (Rest of window hidden.)_

### CASE B — File watching is off (branch on WHY)

One band, two messages depending on where the "off" comes from. Global off wins when
both are off (nothing watches regardless of the deck setting).

**B1. Global (Settings):**
> **File watching is off for all decks.** You turned off *Watch source files* in Settings,
> so linked files never update live. Every deck stays a self-contained copy.

Button: `Open Settings…`

**B2. This deck (per-presentation override):**
> **File watching is off for this deck.** You turned it off for this presentation, so its
> linked files never update live. It stays a self-contained copy. Other decks are unaffected.

Button: `Watch files for this deck`

_Links are listed below for reference. No Trust/Approve actions (they're moot until
watching is back on)._

### CASE C — You created this deck (trusted · file-new) AND file watching is on. 
> **You created this deck, so it's trusted.** Its linked files are watched by default.
> **{approved} assets approved · {watched} watched{, blocked?}.**

Deck action: `Stop trusting this deck`
Provenance chip: `Trusted {trustedWhen} · created here`

### CASE D — You previously trusted this received deck (trusted · trusted)
> **You trust this deck.** *(Trusted {trustedWhen}.)* **{approved} approved · {watched}
> watched.** Any files added or changed since then are listed below for approval.

Deck action: `Stop trusting this deck`

### CASE E — Received, never trusted (untrusted-new)  ← the important one
> **This deck isn't trusted.** You got it from somewhere else. It displays right now.
> Everything is embedded, but its **{eligible} link(s)** to files on your computer stay
> **off** until you trust it. Trusting reads nothing by itself. You then choose which
> files to watch.

Primary action: `Trust this deck`
_(After trusting, per-file / per-folder Approve appears — see §2.)_

### CASE F — Trust expired (untrusted-ttl)
> **This deck's trust expired.** You trusted it {trustedWhen}, but it's been dormant
> ~30 days, so watching is paused. Your **{approved} previous approval(s)** are
> remembered. Re-confirm to resume.

Primary action: `Re-confirm to resume watching`

---

## 2. Blocked warning band (shown ABOVE the list whenever `{blocked} > 0`)

Loud, red. Blocked = a link whose real target isn't a presentation file.
> **⚠ {blocked} link(s) in this deck don't point to presentation files.** Eigendeck will
> **never use them in the presentation**, trusted or not. This usually means a file was
> replaced or corrupted on disk. But it can also mean a link was tampered with to point
> somewhere it shouldn't. Review the ⚠ rows below.

_(Policy: we do NOT block trusting the deck — file-format drift is a legitimate cause —
but these rows are never approvable and are called out here + inline.)_

---

## 3. The link list

Header row / counter (always, when there are links):
> **{total} linked file(s)** — {approved} watched · {eligible} not watched{ · {blocked} blocked}{ · {missing} missing}

### Per-row content
- **Line 1:** the authored reference, monospace — `figs/diagram.svg`
- **Line 2 (only if resolved ≠ reference):** `→ {resolvedTarget}` (red for Blocked) — surfaces symlinks / `../..`
- **Line 3:** usage — `Used on slide 3` / `Used on 2 slides` / `Unused`
- **State badge + provenance** (see below)
- **Row action** (see below)

### Per-row STATE (badge · provenance · action)

| State | Badge | Provenance / detail line | Action |
|---|---|---|---|
| **Watched** | 🟢 Watched | `Approved {when} · {how}` (e.g. "3 days ago · added") | `Revoke approval` |
| **Not watched** (eligible), trusted | 🟡 Not watched | `Not watched — approve to enable live updates` | `Approve` |
| **Not watched**, untrusted | 🟡 Not watched | `Trust the deck first to approve` | _(disabled)_ |
| **Blocked** | 🔴 Blocked | `⚠ Not a presentation file{ — → resolvedTarget}. Never read.` | _(none)_ |
| **Missing** | ⚪ Missing | `Source file not found on disk — showing the last-loaded copy` | `Relocate…` |

Row-state copy (verbatim drafts):
- Watched provenance: `Approved {when} · {how}` where {how} ∈ *added* / *relocated* /
  *approved here* / *approved (whole folder)* / *trusted*.
- Not-watched (trusted): `Not watched — approve to let this file update the deck live.`
- Not-watched (untrusted): `Trust the deck first, then approve this file.`
- Blocked: `⚠ This isn't a presentation file{ — it resolves to {resolvedTarget}}. Eigendeck will never read it.`
- Missing: `⚠ The source file is missing from disk. The deck still shows the last copy it loaded.`

### Bulk action (trusted deck, when ≥2 eligible in one folder)
Section above/below the rows:

> **Approve a whole folder:**
Button per folder: `Approve all {N} files in {folder}`

---

## 4. Deck-level action bar (bottom)

Depends on state:
- **Untrusted (E):** `Trust this deck`
- **Lapsed (F):** `Re-confirm to resume watching`
- **Trusted (C/D):** `Stop trusting this deck`. Guards on a NATIVE system confirm
  (implemented, d5b3156):
  > **Stop trusting "{deckTitle}"?** Its linked files stop updating and all {approved}
  > approvals are forgotten. The deck still displays fully using the embedded copies. You
  > can trust it again later.  → buttons `Stop trusting` / `Cancel`
- Always: a quiet `Learn about deck security` link to the manual.

---

## 5. Toast wording (cross-refs, already implemented)
- On-open review: `{N} NEW linked file(s) aren't watched. Review` / `{N} … still …`
- TTL: `This deck's trust expired. Re-confirm to resume watching.` Opens the security window.
- Re-confirm ok: `Trust restored. Linked files will live-update again.`

---

## Decisions (resolved)
1. **"Stop trusting" confirm** → NATIVE modal confirm. DONE (d5b3156).
2. **Revoke approval** → instant, per-file; separate from stop-trusting.
3. **Blocked band** → current copy is fine (blunter variant available on request).
4. **Provenance** → relative under ~7 days, absolute after.
5. **CASE B (watching off globally OR for the deck)** → list links read-only.

Still TODO in copy: CASE B split into the two sub-variants (global-off → Open Settings;
deck-off → per-deck watch toggle). Then the full window can be implemented from this doc.
