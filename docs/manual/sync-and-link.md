# Sync and link

## The rule

Two elements on different slides can be related in two — and only two —
ways, and they mean different things:

- **Sync** = *the same element, shown on several slides.* Edit it once and
  every copy updates: same text, same picture, same position. This is for
  information you want to repeat — a running title, a logo, a standing
  example you keep referring back to.
- **Link** = *an animation.* The same-looking element sits at a **different
  position** on each slide, and the presenter glides it from one spot to the
  next as you advance. This is for build-ups and motion. The two elements
  stay independent — only their movement is tied together.

A short way to remember it: **sync unifies, link animates.**

The most important consequence: **position follows sync, not link.** Synced
copies always share a position — move one, they all move. A link never moves
anything on its own; it only animates between positions you set yourself.

## How you make each one

- **Sync** comes from **duplicating a slide** (right-click a slide thumbnail →
  Duplicate, or `Cmd/Ctrl+D` on the thumbnail). Every element on the copy is
  synced to its original. They're now one thing on two slides.
- **Link** comes from the **"L" button** on a selected element ("link to an
  element on another slide"). It opens a picker; click the target on another
  slide and the two are linked for animation. Linking is **non-destructive** —
  it never merges or changes content, it only sets up the animation.

## Making an animation (the one workflow worth memorising)

Because synced copies share a position, you can't animate them directly. The
move is: **duplicate → free → move.**

1. Duplicate the slide so the element is on both (synced, same spot).
2. On the second slide, select the element and click the **"S" badge** to
   **Free Position** — it stops being synced but stays part of the animation.
3. Drag it to its new spot. In presenter mode, advancing the slide now
   animates the element from the first position to the second.

## The badges

Select an element and two little badges may appear:

- **S (sync).** Green = synced; click to **free** this copy's position. Grey =
  either freed (click to **re-sync**) **or** animation-linked-but-not-synced
  (click to **promote** the link to a sync — see below).
- **A (animation).** Purple = animated; click to **unlink**. Grey = click to
  **re-link**.

## Promoting a link to a sync

A link is just animation; if you decide two animation copies should actually
be *the same element* (mirror, not motion), select one and click its **grey
"S"** badge to **promote**. The one you click becomes the master — the others
become identical to it. This is **destructive** (the copies' separate
positions and content are discarded in favour of the master's), so it asks for
confirmation. There's no automatic reverse; sync is a deliberate step up from
link, never a side effect of it.

If the linked copies are **notebooks with different recordings**, promoting
can't keep both — so instead of a plain confirm you get a **chooser**: each
copy is shown with a one-line summary of its recording, and the one you pick
becomes the master (its recording is kept; the others are discarded). This is
how you "sync notebooks": link them, then promote and choose which recording
the unified notebook should carry.

## Copy and paste

Copy an element (`Cmd/Ctrl+C`) and where you paste decides the relationship:

- **Paste on a different slide** → the copy is **linked** to the original
  (animation), *unless* the original is part of a sync group, in which case the
  paste **joins that sync group** (another synced copy).
- **Paste on the same slide** → a **plain independent copy**. (You can't
  animate between two things on one slide, so there's nothing to link.)
- **`Cmd/Ctrl+D`** duplicates an element in place as an independent copy.

## Why this design

Most "same element across slides" features conflate two genuinely different
intentions — *repeat this* and *animate this* — into one confusing toggle.
Splitting them keeps each predictable: a synced title never drifts out of
place, and an animation never silently rewrites your content. The "free to
animate, promote to unify" path lets you move between the two on purpose,
without either one happening by accident.

(For the under-the-hood model — one storage row + slide references, how it
survives save/reopen — see the developer note `docs/sync-and-link.md`.)
