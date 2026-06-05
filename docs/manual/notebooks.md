# Notebooks

## The rule

A **notebook element** puts a Jupyter notebook (`.ipynb`) on a slide.
Eigendeck renders the cells as part of the slide, and — if a kernel is
available — lets you run them live during a talk.

The key idea: **the `.ipynb` file is never modified.** Everything you do to
the notebook inside your deck — edit a cell, run it and capture its output,
add a new cell on the fly — is saved as a **recording** attached to the
element and stored *in the deck*, layered on top of the pristine source file.
Open the deck later (even with no kernel running) and your edited code and
captured outputs are right there.

## The recording

The recording holds three things, all kept in the deck, none written back to
the `.ipynb`:

- **cell edits** — changes you make to a cell's source inside the deck;
- **recorded outputs** — the result of running a cell, captured so it shows
  again next time without re-running;
- **added cells** — cells you author live in the deck (they're not in the
  original file).

This is what makes a notebook-driven talk **reproducible and portable**: the
deck carries the exact code and results you presented, while your source
`.ipynb` stays clean for everyday work in Jupyter.

## Editable vs. file-watching

By default a notebook is read-only in the deck (you still run cells; you just
can't retype them). Turn on **Editable** (per element in the Inspector, or as a
global default in Settings → General) to edit cell source in place.

Editing in the deck and watching the file on disk are at odds — a disk change
would clobber your in-deck edits — so **making a notebook editable turns off
file-watching for it.** When you *do* want the latest from disk, use the Asset
section's **Reload from disk** (which intentionally discards the in-deck edits
and pulls the current `.ipynb`).

## Running cells — kernels

A notebook element only says *which kernel it needs* (e.g. `python3`). The
actual server URL and token live in a per-machine registry, not in the deck.
See **[Jupyter servers](notebook-servers.md)** for how that works and what the
topbar status pill means. Cells still display fine with no kernel — you only
need one to *run* them.

## Display options

Each notebook's Inspector lets you tailor how it appears on the slide:

- **Hide header** (drop the kernel/title strip),
- **Syntax highlighting** on/off,
- **Line numbers** on/off (applies in both the static and editing views),
- **Hide markdown** cells, **show only certain cells**, show a **border**,
- **Font size** (the same named scale as text — see [Text sizes](text-sizes.md)).

## The same notebook on several slides

Duplicate a slide and the notebook becomes **synced** — it is *one* notebook
shown on both slides, sharing **one recording**. Edit a cell or capture an
output on either slide and both update; it stays one thing through save and
reopen. To give instances independent positions for an animation, or to
understand sync vs. link, see **[Sync and link](sync-and-link.md)**. (When you
*free* a synced notebook, it keeps its own copy of the recording; when you
*promote* a link to a sync, the master's recording is the one that's kept.)

**Copy carries the recording.** Copy/paste or duplicate a notebook and its
recording comes along: an independent or animation-linked copy gets its **own
copy** of the recording (it can then diverge), while a copy that **joins a sync
group shares** that group's single recording.

## Previews

Wherever Eigendeck needs a small stand-in image of a notebook — the slide
thumbnails in the sidebar, the link picker — it shows a cached picture of the
rendered notebook, refreshed as you edit it, rather than a blank box.

## Why this design

A talk should be **reproducible without a live kernel** and your source files
should stay **pristine**. Recording the session into the deck (instead of
editing the `.ipynb`) gives you both: you can rehearse, capture the outputs you
want, and present the exact same thing weeks later on a laptop with nothing
installed — while the notebook you keep iterating on in Jupyter is untouched.
