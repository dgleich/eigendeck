# Link model: shared-token "group" vs. directed pointer (linked list)

Design note — 2026-06. Status: **DECIDED to keep the current shared-token model
for now**; revisit if the confusion/bug pattern recurs. Captured because the
"group" framing keeps causing implementation confusion (and bugs).

## The two models

**(A) Shared-token group (CURRENT).** `link_id` is a freestanding token (a fresh
`crypto.randomUUID()`), written identically onto every member. It is *not* any
element's id and points at nothing. Membership = "every element sharing this
token." Stored as a promoted `elements.link_id` column (index `idx_el_link`).

**(B) Directed pointer / linked list (CONSIDERED, not adopted).** `link_id` would
store *the id of the element it links to* — A→B→C as a singly-linked list.
Forward traversal = reverse lookup (`WHERE link_id = ?` / in-memory scan).

## What actually consumes link_id (so we know what "group" buys us)

- **PresentMode animation** (the main consumer, `PresentMode.tsx:266-291`): it is
  **pairwise between ADJACENT slides**. Builds `prevByLinkId` for the previous
  slide, then for each current-slide element with a matching token emits
  `{from: prev, to: current}`. The token is just a **join key** to find "the same
  object on the neighbouring slide." It even uses a Map keyed by token, so two
  members on the *same* slide clobber — the model inherently wants ONE member per
  slide. ⇒ The animation is fundamentally pairwise; the user's mental model
  ("a link is between two elements") is correct for it.
- **promoteToSync** (`presentation.ts`, `App.tsx:927`): the ONE genuinely
  group-wide op — collapses *all* members sharing the token into a sync group.
- **Cosmetic/safety**: LinkOverlay green "isLinked" highlight; the S-badge
  "hasPartner" check; the `#2` `mergeIds` merge-two-groups safety net.

So "group" only truly earns its keep for **multi-slide chains** (one object on
slides 1·2·3·4 with one token → each adjacent pair animates for free) and for
**promote**. Everywhere else it's emergent.

## Why model (B) is tempting

- Matches the mental model; kills the "group" abstraction that confuses authors
  (human and LLM) — the `#2` stranding bug (S9) and its merge complexity exist
  *only because* of the shared token. Pointer model: linking A→C is just
  `A.link_id = C`; no groups to merge, no stranding class.
- Animation lookup becomes a direct id match instead of a Map build.
- Walking is cheap (reverse lookup is rare and in-memory in PresentMode).

## Why we are NOT doing it now — the real cost is referential integrity

The token's one virtue is being **independent of element identity**, so it
survives edits with ZERO maintenance. A pointer-to-id must be kept valid, and
this app mutates element identity constantly:

- **Delete** → dangling pointer; must repair "whoever pointed at the deleted
  one" (null or splice `A.link_id = B.link_id`). Today delete is a link no-op.
- **Duplicate / paste** → copy gets a fresh id; its edge must be re-wired.
- **Slide reorder** → THE subtle one, and the specific worry that stalled this:
  with a token, adjacency is recomputed from current slide order every present,
  so reorder is free — but that means *delete an intermediate slide's member,
  then reorder so the survivors become adjacent, and they animate together
  again.* Is that correct or surprising? Undecided. A directed pointer would NOT
  silently re-link (the edge was severed), but then reorder must repair
  direction. **Neither behaviour is obviously "right"** — this is the crux to
  settle before any change.
- Couples links to element ids — mostly safe for purely-linked elements (they're
  standalone rows with stable ids; the id churn we fixed this session was
  specific to *synced* duplicated instances, which can no longer be linked), but
  the new-id mint points (dup/paste) still need explicit wiring.

## Decision

Keep model (A). The trigger to revisit: if link semantics keep generating bugs,
or if we want true severed-link behaviour under reorder. If we do switch:
schema is unchanged (`link_id` already exists) — it's a *meaning* change (token →
id) + a one-time data migration + four edit-path handlers (delete, duplicate,
paste, reorder) + decide the reorder-re-link question above.

## Open question to resolve regardless of model

"Delete a member on an intermediate slide, then reorder the remaining members
adjacent — should they re-link/animate?" Token model says yes (silently);
a severed-pointer model says no. Pick the intended behaviour; it should be
documented either way.

Related: [[project_eigendeck_sync_link]], [[project_eigendeck_linked_objects]].
GitHub: #30 (link asymmetry), #32 (import position diffs on synced) — see also
any "linked objects / animation" issue.
