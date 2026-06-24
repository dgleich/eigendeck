# Text sizes

## The rule

A deck has one type scale, applied uniformly across all slides. Five
named sizes:

| Name | Default | Used by |
|---|---|---|
| `footnote` | 24 px | footnote text preset; small notebook cells |
| `note` | 32 px | annotation text preset; notebook cells (default) |
| `body` | 48 px | body and textbox text presets; large notebook cells |
| `title` | 72 px | title text preset; reserved for titles |
| `hype` | 96 px | hype text preset; reserved for hype |

You can change any of these px values at the deck level — open the
Inspector with no element selected, scroll to **Text sizes (px)** in
the Presentation section, and edit the spinner for the size you want
to adjust. The override propagates to every element in the deck that
uses that named size.

You can also override the size on an individual element. Every
sized element — text and notebook — shows the same font-size widget
in its inspector: three named buttons (`body / note / footnote`)
plus a numeric spinner. Click a name to bind the element to the
deck's scale at that size, or type a custom px value to pin it.
This is the escape hatch for cases where the named scale doesn't
fit, and it's the same control everywhere so you only learn it
once.

There is **no slide-level text size override**. This is intentional.

The size applies to the **whole element** — you can't mix font sizes *within* a
single text element. That, too, is intentional: it keeps the text inside an
element harmonious. Need two sizes? Use two elements (a Title and a Body, say).

## Why this design

A presentation reads as one document, not a sequence of independent
slides. Inconsistent type sizes between slides break that read —
audiences (and presenters reviewing their own decks) notice when
"body" on slide 4 is visibly different from "body" on slide 5, even
if neither one looks wrong on its own. Tooling that makes slide-by-
slide size changes easy makes that drift the default; tooling that
makes it harder makes consistency the default.

The deck-level type scale is the constraint that delivers that
consistency. Pick five sizes that work for the kind of talk you're
giving — a lecture hall projection wants different numbers than a
laptop walkthrough — and the rest of the deck inherits them. When
you decide a title is too small, you change the title size *once*
and every title slide updates.

The per-element override exists because real talks have real
exceptions: one slide where you genuinely need a smaller body cell
to fit a long matrix, one notebook on one slide where you want a
larger code font for emphasis. These are individual judgement calls,
not slide-wide aesthetics, so they live on the element they apply
to.

A slide-level override would sit between those two: bigger blast
radius than per-element, smaller than per-deck. It would be useful
just often enough to *seem* like the right tool for the job, then
silently produce inconsistent slides. We left it out so the choice
stays binary: "this is how the deck looks" vs. "this one element is
a deliberate exception."

## Workflow

There are two places to set the scale:

- **Per-deck** (Inspector → Presentation section → Text sizes (px)) —
  applies to the currently open deck only. This is where you tune
  the scale for a specific talk.
- **Global / new-deck default** (Eigendeck menu → Settings → Default
  text sizes) — seeds the scale for every NEW deck you create.
  Existing decks aren't touched; they keep whatever they were saved
  with. Use this when you've found a scale you like and want it as
  the starting point for everything you make.

Both editors show the built-in default beside each field so you
always know what the value would be if you cleared the override.

1. **Set the scale once.** Open the Inspector with no element
   selected. Adjust `footnote / note / body / title / hype` in the
   **Text sizes (px)** section until the proportions look right on
   the kind of screen you'll present on. Default values are tuned
   for a 1920×1080 projection at conference distance. If you like
   the result and want it as your global starting point for future
   decks, copy the same values into the Settings dialog's Default
   text sizes section.

2. **Use the named sizes everywhere.** Text presets already pick from
   the scale; you don't need to think about it. The same `body /
   note / footnote` picker appears on every sized element — click a
   name to bind that element to the deck's scale (overriding the
   preset for text, or the default `note` for notebooks).

3. **Reach for the numeric override sparingly.** If you find yourself
   typing a custom px value on more than two or three elements per
   deck, the scale itself is probably wrong — go back to step 1 and
   adjust the deck-level value instead. That single change fixes
   every element at once and keeps the deck consistent.

4. **`title` is reserved.** It's only available to title text
   elements. Notebooks and other elements don't list it in their
   size picker. If you need title-sized text in a non-title element,
   use the numeric override — and ask yourself whether the element
   should actually be a title.

## Common pitfalls

- **"This one slide needs different sizes."** Almost always either
  (a) the element needs a numeric override (one element, not the
  whole slide), or (b) the deck's scale is wrong (every slide is
  paying the cost; fix it once at the deck level). The third option
  — "this slide is genuinely a different kind of slide" — is rare
  enough that creating a *whole separate deck* and linking to it is
  usually a better answer than fragmenting your scale.

- **Bumping a name to "fix" a single slide.** If you change `body`
  from 48 to 56 because slide 12 looks cramped, every body-preset
  element on every slide jumps. Use a per-element override on slide
  12's element instead.

- **Picking numbers from a designer's website.** Most editorial type
  scales target a reading distance of two feet. Eigendeck talks
  default for projection at 20+ feet. The defaults are bigger than
  you think they should be on your laptop, and that's correct.

## See also

- `DESIGN_DECISIONS.md` "Preferences cascade" — the formal model for
  how deck → element resolution works (default-setting flavor).
- `LLM-EDITING.md` — schema reference for `PresentationConfig.textSizes`
  and `NotebookElement.fontSizeName` / `fontSize`.
