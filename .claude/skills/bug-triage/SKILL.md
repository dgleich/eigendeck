---
name: bug-triage
description: How to handle a bug report in Eigendeck. Use whenever the user reports a bug, a defect, something "broken", or "not working" — before diagnosing or touching code. Covers filing a GitHub issue FIRST (record-only), establishing a reproduction, weighing fixes and their implications, and presenting tradeoffs when the fix isn't trivial.
---

# Handling a bug report

When the user reports a bug, follow these steps **in order**. Do NOT jump ahead —
the most common mistake is diagnosing or code-reading before the bug is even
tracked. (This skill exists because a whole session's worth of reported bugs got
logged only to local memory and never to GitHub — memory is not a tracker.)

## Step 1 — File a GitHub issue FIRST (record-only)

Before ANY diagnosis, exploration, or context-gathering, file the issue so it's
tracked. Record only: a title and the user's own words. No root cause, no
speculation — that comes later as comments.

```bash
export GH_TOKEN="$(cat /work/.github_token)"   # if unauth'd, this is NOT a reset — just export it
# Check for an existing/duplicate issue first (open AND closed — sync/durability bugs recur):
gh issue list --repo dgleich/eigendeck --state all --limit 200 --search "<keyword> in:title,body" \
  --json number,state,title -q '.[] | "\(.number)\t\(.state)\t\(.title)"'
# File it (record-only):
gh issue create --repo dgleich/eigendeck --label bug \
  --title "<short symptom in plain words>" \
  --body "<the user's report, in their words>

Reported by David, <date>. Recording only."
```

- The only label that exists is `bug`.
- Tell the user the issue number immediately.
- If a related issue already exists (especially a CLOSED one — see #30/#45/#32/#43
  for sync, #187–#191 for the 2026-09 batch), link it in the body rather than
  duplicating, and note whether this looks like a recurrence.

## Step 2 — Establish a reproduction scenario

Build the repro BEFORE deep code-reading (code archaeology first is the second most
common mistake). For this app the repro is almost always an **e2e probe** — see the
`eigendeck-e2e` skill. The real app, real `invoke`, real SQLite, driven via the
`window.__eigendeck` seam, is what catches frontend↔Rust and render-mode bugs that
vitest can't.

- Mirror an existing probe (e.g. `e2e/internal-paste-probe.mjs` for clipboard flows)
  rather than starting from scratch.
- A probe that REPRODUCES the failure (goes red) is the goal. A probe that PASSES is
  also a real result — it tells you the bug is elsewhere (a passing demo copy/paste
  probe proved the bug was in event routing, not the paste code — #188).
- If you genuinely can't reproduce it headlessly (e.g. a macOS-native / WebKit
  pixel / live-timing case), say so plainly and note what WAS and WASN'T covered.
- Post what you find as a comment on the issue as you go ("add context later").

## Step 3 — Look at potential fixes and their implications

Only once you can point at the cause: survey fixes and what they touch.

- A property/element/render change almost always spans multiple output modes —
  follow `docs/ELEMENT-CHECKLIST.md` (editor, present, present-animation, HTML
  export, PDF/print, link overlay, thumbnail). A fix in one mode is silently
  dropped by the others (the #98/#85 bug class; #187 is exactly this — export
  paths bypassed the shared `getSlideNumber`).
- Note shared helpers: frontend logic used by both `.ts` and `.mjs` (export/CLI)
  code often needs extracting to an `.mjs` (as `textSizes.mjs`).
- Write the confirmed root cause + the fix options as a comment on the issue.

## Step 4 — If the fix isn't trivial, present tradeoffs

If the fix is trivial and low-risk, just do it (repro test → fix → gates green →
commit, per AGENTS.md). If it isn't — multiple viable approaches, a data-model or
API change, cross-cutting risk, or a real behavior decision — STOP and present the
tradeoffs for the user to choose (use AskUserQuestion). Don't silently pick.

## Never overstate the outcome

Claim a bug is FIXED only when **the user's exact scenario** is reproduced and then
verified fixed. Fixing a *related* path is not fixing the reported bug — say
"related path fixed; the reported case is unconfirmed" and keep the issue OPEN
(this is #191: an autosave-debounce durability path was fixed, but the user's
save→reload sync-revert was never reproduced, so the issue stays open). Keep GitHub,
memory, and the worklog consistent — don't let one say "FIXED" while another says
"unconfirmed".

## Related

- `eigendeck-e2e` — build the Step 2 reproduction.
- `docs/ELEMENT-CHECKLIST.md` / `docs/headless-verification.md` — Step 3 implications
  and what can/can't be checked headlessly.
- `commit-presentations` / AGENTS.md "Committing" — one green commit per fix.
