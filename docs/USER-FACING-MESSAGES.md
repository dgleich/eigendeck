# User-facing messages — be informative, not silent

Eigendeck's stance on messages is the **opposite of "no error messages."** When
something is blocked, changed, refused, or behaving in a way the user didn't
directly cause, we *tell them* — in plain language — **what happened, why, and
what they can do about it.** Silent failure and vague wording are bugs.

This applies to dialogs, toasts, inline banners, empty states, and disabled
controls alike.

## The three questions every message should answer

1. **What happened / is happening?** State the fact plainly.
   *"live-crypto.html is different from the copy in this deck."*
2. **Why?** Give the *actual* reason, not a vague or generic one.
   *"This deck isn't trusted, so Eigendeck doesn't watch its source files for changes."*
3. **What can I do?** When there's a fix or a choice, offer it — ideally as a
   button or a concrete next step.
   *"Save…"* action on the unsaved-tracking toast; *"Update slide 3 to this new
   version too" / "Keep slide 3 as-is and add this as a separate copy."*

If a message can't answer #3 (nothing to do), that's fine — but #1 and #2 are
never optional.

## Principles

- **Name the real cause.** Don't say "isn't set up to auto-update" when the
  reason is "this deck isn't trusted." Compute the true reason and say it (see
  `whyNotLive` in `src/lib/assetInsert.ts`). A vague reason is worse than none —
  it sends the user to fix the wrong thing.
- **Never claim something happened that didn't.** The collision dialog used to
  say an auto-update "has already happened" even on decks where the watcher never
  ran. Branch the copy on the real state (`existingChanged`) so every sentence is
  true.
- **Plain language, no jargon.** "phone home," "live data," "watch the source
  file" — not "egress," "IPC," "temporal row." Write for the professor giving a
  talk, not the engineer who built it.
- **Describe, don't accuse.** Most surprising states are benign (an older file, a
  deck from a colleague). Say what it is; don't imply the user did something wrong.
  See the blocked-file copy in `SecurityPanel.tsx` (`blockedText`).
- **Show overridden/disabled state, don't fake "off."** A control that has no
  effect (because a broader setting overrides it) should look disabled and say why
  — not sit there as an active, unchecked box. See the Internet tab when the
  global switch is off (`SecurityPanel.tsx`): the per-deck toggle greys out and a
  banner explains it.
- **Prefer inline + contextual over modal.** A toast or an inline banner next to
  the thing beats a modal that interrupts. Reserve modals for a real choice the
  user must make now (e.g. the collision dialog).
- **Distinguish causes that need different actions.** "Rate-limited" and "offline"
  are not the same failure; a demo should say which (see `live-crypto.html`) so the
  user knows whether to wait or to check their connection/settings.
- **Degrade helpfully.** When a feature can't run, keep what still works and
  explain the gap, rather than blanking the whole thing (the live-crypto demo keeps
  the last prices and annotates the status line on a failed refresh).

## Anti-patterns

- Silent no-op (the action appears to do nothing, no feedback).
- "Something went wrong." / "Error." / "Invalid." — no what, why, or fix.
- A reason that's plausible but wrong ("isn't set up" when it's a trust issue).
- Claiming an outcome that didn't occur ("already updated").
- Blaming the user for a benign state.
- A dead/greyed control with no explanation of why it's disabled.

## Worked examples in the codebase

- **Collision dialog** (`src/components/CollisionDialog.tsx`, `src/lib/assetInsert.ts`):
  branches on whether the embedded copy actually changed; states the real reason
  it wasn't live-updated; offers two plain-language choices.
- **Security → Internet tab** (`src/components/SecurityPanel.tsx`): per-demo
  disclosure of hosts + purpose; overridden controls grey out with a banner
  explaining the global switch.
- **Unsaved / can't-track toast** (`maybeWarnUnsavedProject`): explains the
  limitation and offers a "Save…" action.
- **Live-data demo** (`example-demos/live-crypto/live-crypto.html`): separates
  rate-limit vs offline vs HTTP error, keeps last-good data, tells the user which.
- **Deck security bands** (`SecurityPanel.tsx` `StatusBand`): every trust state
  gets a specific, reassuring explanation ("You never need to trust a deck just to
  view it").
