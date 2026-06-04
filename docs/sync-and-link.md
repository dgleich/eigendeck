# Sync and Link — element relationships across slides

> **Status: authoritative source of truth.** This document settles the
> semantics of Eigendeck's two cross-slide element relationships. Recent bugs
> came from conflating them — read the
> [Common mistakes](#common-mistakes) section before touching this code.

Eigendeck has exactly two ways an element on one slide can relate to an element
on another slide:

| Relationship | Field    | Meaning                                                       |
| ------------ | -------- | ------------------------------------------------------------ |
| **Sync**     | `syncId` | The **same** element shown on multiple slides (a mirror).    |
| **Link**     | `linkId` | An **animation** pairing between two *different* elements.   |

These are independent. An element can have a `syncId`, a `linkId`, both, or
neither. Duplicated elements get **both** (see
[Lifecycle](#lifecycle-duplicate--free--move--animate)).

The four relevant fields are declared in
`src/types/presentation.ts:157-160`:

```ts
linkId?: string;   // animation link: animate between positions in presenter
syncId?: string;   // content link: sync position/text across slides
_linkId?: string;  // stored linkId when temporarily unlinked (for re-linking)
_syncId?: string;  // stored syncId when temporarily unsynced (for re-syncing)
```

---

## Sync (`syncId`) — the same element, mirrored

Two instances that share a `syncId` are **the same element**. They have the
same content, the same style, and the **same position**. Editing one — or
**moving** one — updates all of them. A mirror, not a copy.

- **Editing propagates.** `updateElement`
  (`src/store/presentation.ts:403-450`) applies the change to the target
  instance, then, if it has a `syncId`, applies the *data* portion of the
  change to every other instance with the same `syncId` across all slides
  (`presentation.ts:419-439`). Every data field propagates — content (`html`,
  `position`), styling, notebook display options, etc. Only identity/linkage
  fields are stripped before propagation (see `IDENTITY_KEYS` below), so each
  instance keeps its own `id`/`linkId`/`_*` while sharing all data.

- **Moving propagates.** `moveElementsBy`
  (`src/store/presentation.ts:569-595`) collects the `syncId`s of the moved
  elements and shifts **every** instance sharing those `syncId`s on **every**
  slide by the same `dx, dy` (`presentation.ts:577-594`). Arrows shift all four
  endpoints; everything else shifts `position`.

> **Position is governed by `syncId`, period.** A synced element mirrors
> position by construction. There is no "synced content but free position"
> state — if it has a `syncId`, moving it moves all peers.

---

## Link (`linkId`) — an animation pairing

Two elements that share a `linkId` are **different** elements on different
slides that the presenter **animates between**. The whole point of animation is
that the two have **different positions** (and possibly size/content), so the
presenter tweens from one to the other when advancing slides.

A `linkId` carries **no** positional coupling. It does *not* sync content and it
does *not* make position independent — it is purely an animation pairing. The
`LinkOverlay` UI (the "L" button, `src/components/LinkOverlay.tsx`) lets you pick
a target element on another slide; on click it calls
`linkElements(source, targetSlideIndex, target)`, which sets **only** a shared
`linkId` (via `linkPairDeltas`).

**"L" is non-destructive and never syncs.** It sets `linkId` only — the two
elements stay separate (their own position, content, and notebook recording) so
the presenter can animate between them. Collapsing two elements into one entry
(sync) is a *separate, destructive* operation: it is produced cleanly only by
**duplicate** (the junction model), because two already-existing rows cannot
become one entry without deleting/re-pointing. So "L" deliberately does not, and
must not, set `syncId`.

---

## The key insight: link does **not** free position

Because position is governed by `syncId`, a `linkId` alone cannot give you the
independent positions that animation needs. Independent position comes from
**freeing** the element — *removing its `syncId`* while keeping its `linkId`.

This is spelled out in the move code itself
(`src/store/presentation.ts:572-576`):

> Position is governed by syncId: synced instances mirror position (move one →
> move all). Independent position (for animation) comes from FREEING an element
> (removing its syncId), not from a linkId — duplicated elements carry a linkId
> yet must stay position-synced until freed.

---

## Lifecycle: duplicate → free → move → animate

1. **Duplicate.** `duplicateSlide` (`presentation.ts:212-249`) and
   `addBuildSlide` (`presentation.ts:325-366`) give every element on both the
   original and the copy **both** a `linkId` (fresh-or-inherited) **and** a
   `syncId`. The `syncId` defaults to the element's **own `id`**
   (`presentation.ts:224`, `:337`) so the group's identity — and the
   notebook-overlay key `syncId ?? id` — is stable across duplicate → save →
   Save As. They also clear `_syncId`/`_linkId` to sever any old remembered
   group.

   Result: the duplicated elements are **mirrored (synced) AND
   animation-capable**, but they stay mirrored — same position, edits/moves
   propagate — until you free one.

2. **Free Position.** Run "Free Position" (`freeElement`,
   `presentation.ts:457-467`) on one instance. This **drops its `syncId`**
   (remembering it in `_syncId`) while **keeping its `linkId`**. The instance is
   now a standalone element that still belongs to the animation pair.

3. **Move it.** Now that it has no `syncId`, moving it
   (`moveElementsBy`) affects only this instance — its peer on the other slide
   stays put.

4. **Animate.** The two instances now share a `linkId` but sit at different
   positions, so the presenter tweens between them.

```
duplicate  →  [A: syncId=g, linkId=L]   [A': syncId=g, linkId=L]   (mirrored)
free A'    →  [A: syncId=g, linkId=L]   [A': syncId=undef, _syncId=g, linkId=L]
move A'    →  A' moves alone; A unaffected
present    →  advancing slide animates A → A' (shared linkId L)
```

---

## What each relationship is FOR

- **Linked elements exist only for animation.** A `linkId` pairs elements across
  slides so the presenter tweens between their (different) positions. Nothing
  else — no shared content, no shared position.
- **Synced elements exist to unify information across slides.** A `syncId` makes
  several slides show the *same* element; edit it once, every instance updates.

## How elements join a group (duplicate · copy/paste · promote)

| Action | Result |
| --- | --- |
| **Duplicate slide / Build slide** | Elements become **synced** (mirrored) and carry a `linkId` (animation-capable). One entry in storage (row + junctions). |
| **"L" / Time-Machine button** | An **animation link** only (shared `linkId`). Non-destructive; never syncs. |
| **Copy an element, paste on a DIFFERENT slide** | The paste is **linked** (animation) to the element it was copied from — *unless* the source is part of a **sync group**, in which case the paste **joins that sync group** (becomes another synced instance, not just a link). |
| **Copy an element, paste on the SAME slide** | A plain **independent copy** — no link, no sync (you can't animate between two elements on one slide). Detached. |
| **Promote (greyed "S" badge on a linked element)** | Upgrades an animation link → a **sync**: the clicked element is the master; linked instances become the same single entry (shared id/content/position). DESTRUCTIVE, confirmed. `promoteToSync` (`presentation.ts`). |

> **Copy/paste status:** today every duplicate/paste detaches fully
> (`detachDelta`, `App.tsx`) — which is already **correct for the same-slide
> case**. The part still to implement is the **cross-slide** paste: paste onto a
> *different* slide should link to the source (or join its sync group if the
> source is synced). `App.tsx` is the spot — branch on whether the paste target
> slide differs from the source element's slide.

---

## Field reference

| Field      | Lives where      | Meaning                                                                 |
| ---------- | ---------------- | ----------------------------------------------------------------------- |
| `syncId`   | live             | Mirror-group id. Same `syncId` ⇒ same element, same position, edits/moves propagate. |
| `linkId`   | live             | Animation-pair id. Same `linkId` ⇒ presenter animates between them.     |
| `_syncId`  | remembered       | The `syncId` of a temporarily-**freed** element, so it can re-sync.     |
| `_linkId`  | remembered       | The `linkId` of a temporarily-**unlinked** element, so it can re-link.  |

`_syncId` / `_linkId` are *not* alternate live ids — they are the remembered
group of an element that has been freed/unlinked, kept only so the element can
rejoin its group later. They never participate in propagation or animation while
remembered.

### `IDENTITY_KEYS`

`src/lib/syncLink.ts:23` defines the keys that must **never** propagate from one
synced instance to its peers:

```ts
export const IDENTITY_KEYS = ['id', 'syncId', '_syncId', 'linkId', '_linkId'];
```

`updateElement` uses this exact list as its propagation strip
(`presentation.ts:424`) so each instance keeps its own identity/linkage while
all *data* syncs.

---

## Store API — call these, never hand-build deltas

All sync/link transitions go through a small store API
(`src/store/presentation.ts`). The UI must call these and **must not**
hand-assemble `{ syncId, _syncId, linkId, _linkId }` literals — diverging
hand-built deltas were the source of the link-asymmetry bug (#30) and a
strand-on-unlink bug.

| Store action            | Location              | Effect                                                                 |
| ----------------------- | --------------------- | ---------------------------------------------------------------------- |
| `freeElement(id)`       | `presentation.ts:457` | Drop `syncId`, remember it in `_syncId` ("Free Position").             |
| `resyncElement(id)`     | `presentation.ts:468` | Restore the remembered `_syncId` back into `syncId`.                   |
| `unlinkElement(id)`     | `presentation.ts:477` | Drop `linkId`, remember it in `_linkId`.                               |
| `relinkElement(id)`     | `presentation.ts:484` | Restore the remembered `_linkId` back into `linkId`.                   |
| `linkElements(src, slideIdx, tgt)` | `presentation.ts:491` | ANIMATION link only: both sides get the same shared `linkId`. Non-destructive — never sets `syncId`. |

`freeElement`/`resyncElement`/`unlinkElement`/`relinkElement` are thin wrappers:
they find the element on the current slide, compute the delta with a pure helper,
and route through `updateElement` so they inherit sync-propagation, dirty
tracking, and undo coalescing.

### Pure delta helpers (`src/lib/syncLink.ts`)

These return a `Partial<SlideElement>` touching only the four sync/link/identity
fields. No store, no side effects — the single source of truth for the
remember/restore dance, trivially unit-testable.

| Helper                       | Location              | Returns                                                  |
| ---------------------------- | --------------------- | -------------------------------------------------------- |
| `freeDelta(el)`              | `syncLink.ts:27`      | `{ syncId: undefined, _syncId: el.syncId }`              |
| `resyncDelta(el)`            | `syncLink.ts:33`      | `{ syncId: el._syncId, _syncId: undefined }`             |
| `unlinkDelta(el)`            | `syncLink.ts:40`      | `{ linkId: undefined, _linkId: el.linkId }`              |
| `relinkDelta(el)`            | `syncLink.ts:45`      | `{ linkId: el._linkId, _linkId: undefined }`             |
| `detachDelta()`              | `syncLink.ts:51`      | Clears all four (Cmd+D duplicate / paste — stand alone). |
| `linkPairDeltas(target, …)`  | `syncLink.ts:60`      | The **symmetric** per-side delta both sides get when linking — shared `linkId` + cleared `_linkId` (the #30 fix). Link-only: never touches `syncId`. |

Each returns `{}` (no change) when there is nothing to do (e.g. `freeDelta` on
an unsynced element), so callers can no-op cheaply.

### Per-type lifecycle hooks (`src/lib/elementLifecycle.ts`)

So the store stays type-agnostic, element types register hooks that fire on
sync/link transitions:

- `onFree(el, freedId)` — fired by `freeElement` **before** the field flip
  (`presentation.ts:465`), so a type can seed in-memory caches synchronously.
  Notebooks clone their overlay here.
- `onResync(el)` — fired by `resyncElement` (`presentation.ts:474`); notebooks
  discard the fork.
- `onMerge(ctx)` — fired by `linkElements` (`presentation.ts:501`); notebooks
  reconcile recordings. Runs once per **distinct** type among source/target
  (`elementLifecycle.ts:57-62`).

Hooks are registered at app boot (e.g.
`registerNotebookLifecycle`); the store calls only the type-agnostic
`runFreeHook` / `runResyncHook` / `runMergeHook` dispatchers.

---

## Storage / persistence model (`src-tauri/src/storage.rs`)

> See also `SPEC.md` → "Data model — junction table for sync".

The database separates element data from where it appears:

- **`elements`** (`storage.rs:98-107`) — one row per element: `id`, `type`,
  `data` (JSON), promoted `link_id` and `asset_id` columns, plus temporal
  `valid_from`/`valid_to`.
- **`slide_elements`** (`storage.rs:109-116`) — junction: which `element_id`
  appears on which `slide_id`, at what `z_order`.

**A synced element is ONE `elements` row referenced by multiple
`slide_elements` junctions.** That makes editing O(1): one row write, every
slide sees it.

### Canonical id and in-session instances

In storage, a sync group has one **canonical** element id — the real row. But
**in-session** (in the Zustand store) every instance keeps its own `id`; only
the canonical instance corresponds to a real DB row. `db_update_element`
(`storage.rs:1180-1215`) writes that one shared row. The write-through flush
marks every changed instance dirty and therefore also calls `db_update_element`
for non-canonical ids that have **no** row — that is intentionally a **no-op**,
not an error (`storage.rs:1195-1200`): the canonical write already persisted the
shared data.

A synced element gets onto a second slide via a junction-only insert (no new
`elements` row) — see `db_add_element_to_slide` and the note at
`storage.rs:1246`.

### Export — `syncId` re-derivation (`db_export_json`, ~line 1011)

Export counts how many junctions reference each element
(`storage.rs:1054`). When building each slide's elements, it reattaches the
promoted `link_id`/`asset_id` into the JSON, and — crucially — **re-derives
`syncId` as the canonical element id whenever that row is referenced by more
than one junction** (`storage.rs:1086-1092`):

```rust
if el_count.get(element_id).copied().unwrap_or(0) > 1 {
    obj.insert("syncId".to_string(), Value::String(element_id.clone()));
}
```

So `syncId` is not stored as a column; it is a derived fact of "this one row is
shown on multiple slides."

### Import — dedup vs. animation-frame split (`db_import_json`, ~line 685)

Import is the inverse, and it must distinguish true sync from animation frames
(`storage.rs:685-882`):

- For each `syncId` group it tracks the canonical row's **cleaned data**
  (id-stripped, `storage.rs:781-785`).
- **True sync** — a later member with **identical** data/position
  (`storage.rs:793-805`): no new `elements` row, just an extra
  `slide_elements` junction pointing at the canonical id. The duplicate
  instance id dies.
- **Animation frame** — a member with the same `syncId` but **different**
  data/position (`storage.rs:806-827`): kept as a **separate** `elements` row so
  its distinct position survives, and tied to the canonical via a **shared
  `linkId`** so the presenter animates between them. This is issue **#32** — do
  not dedupe animation frames.

### Notebook overlays — owned by the canonical id

Notebook recordings ("overlays") are private per-element assets keyed by the
element's live key `syncId ?? id`, which equals the canonical id for a synced
notebook. On import, the dedup collapses instance ids, so import builds an
`owner_remap` and re-owns any overlay tagged with a now-dead instance id — or
with the group's `syncId` itself — to the canonical element
(`storage.rs:712-718`, `:797-799`, `:831-836`, applied at `:867-877`). Without
this the recording would be unreachable at the element's live key after the
group collapse.

---

## Common mistakes

1. **"`linkId` makes position independent."** No. Position is governed by
   `syncId`. A linked element still mirrors position until you **free** it
   (drop its `syncId`). Animation needs *free* + *linked*, not just *linked*.

2. **"Duplicated elements have independent positions."** No. `duplicateSlide` /
   `addBuildSlide` give them **both** a `syncId` and a `linkId`, so they are
   **mirrored** (move/edit propagates) until one is freed.

3. **Hand-building `{ syncId, _syncId, linkId, _linkId }` deltas in the UI.**
   Don't. Use the store API (`freeElement` / `resyncElement` / `unlinkElement` /
   `relinkElement` / `linkElements`) or the pure helpers in `syncLink.ts`.
   Divergent hand-built deltas caused #30 and the unlink-strand bug.

4. **Propagating identity fields when syncing.** Only *data* syncs across
   instances. Strip `IDENTITY_KEYS` (`id`, `syncId`, `_syncId`, `linkId`,
   `_linkId`) — each instance keeps its own.

5. **Treating `_syncId`/`_linkId` as live ids.** They are *remembered* groups
   for re-joining after a free/unlink, nothing more. They do not propagate or
   animate.

6. **Deduping animation frames on import.** Same `syncId` + **different**
   data/position is an animation frame (#32): keep it a separate row sharing a
   `linkId`. Only same `syncId` + **identical** data dedupes to one row.

---

## Worked example

Two slides; a title box should slide up-and-left as the talk advances.

1. Slide 1 has a `text` element `A` (`id = "a1"`).
2. **Duplicate the slide.** Both `A` (slide 1) and `A'` (slide 2) now have
   `syncId = "a1"` and `linkId = "L"`. They are mirrored: edit the text on
   either, both update; move either, both move.
3. On slide 2, select `A'` and run **Free Position**. `A'` now has
   `syncId = undefined`, `_syncId = "a1"`, and still `linkId = "L"`.
4. Drag `A'` to its new spot. Only `A'` moves — `A` on slide 1 stays put,
   because `A'` no longer has a `syncId`.
5. **Present.** Advancing from slide 1 to slide 2, the presenter sees `A` and
   `A'` share `linkId = "L"` at different positions and animates between them.

On save/export, slide 1's `A` is one `elements` row; if it were *also* still
synced onto another slide it would carry a re-derived `syncId`. `A'`, being a
separate row sharing `linkId = "L"` with different position, is preserved as its
own animation frame (#32).
