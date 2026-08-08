# Files, watching, and auto-reload

## The rule

When you add a file to a deck — an **image, PDF, demo HTML, Jupyter notebook,
video, or `.vtt` captions** — Eigendeck does two things at once:

1. **Embeds the bytes** in the `.eigendeck` file, so the deck is self-contained
   (hand it to someone without your `figs/` folder and everything still renders).
2. **Remembers where it came from** (the source path) and **watches that file**.
   Edit the source on disk — re-run the script that generates a plot, re-export a
   video, tweak a demo — and the slide **updates automatically**.

So a file asset is both *embedded* (portable) and *linked* (live). You get the
LaTeX/Beamer workflow (regenerate → it refreshes) without the fragility (the deck
never breaks if the source file is gone).

## The two mental models

- **Beamer-style (the default).** Your figures come from scripts. Keep the deck
  open, re-run the script, and the new plot appears. Watching is **on**.
- **PowerPoint-style.** You want the bytes frozen at insert time — later edits to
  the source shouldn't leak in. Turn watching **off** (per asset, per deck, or
  globally) and the deck owns a snapshot.

Both always render the asset's *current* bytes; there's no per-slide version
pinning. (Some inserts freeze automatically — e.g. embedding an SVG's external
images severs the link on purpose.)

## Turning watching on/off

Watching resolves through a cascade — most specific wins:

1. **Per asset** — the **Watch** checkbox in the Inspector's *Asset* section
   (select the element). Unchecking it freezes that one asset.
2. **Per deck** — a presentation-level override (Presentation properties).
3. **Global** — Settings → *Auto-reload assets* (the factory default is **on**).

An asset can only opt **out** below what the deck/global allows — it can't force
watching on when the deck has it off.

## Reload from disk

The Inspector's *Asset* section also has **Reload from disk now** (one-shot) and a
**version history** (revert to an earlier embedded version). Reverting writes a new
"current" version in the deck — it never edits the file on disk.

## Notebooks: editing takes control

A notebook is special: you can **edit its cells in the deck** (the recording —
see [Notebooks](notebooks.md)). To protect those edits, **making a notebook
editable turns watching off** for its `.ipynb` — a disk reload won't clobber what
you typed. This is **sticky**: turning editable back off *leaves* watching off;
re-enable **Watch** explicitly when you want it to follow the file again. The
asset keeps its source link, so **Reload from disk** still works (and it discards
your in-deck cell edits, taking the file as-is).

(For **videos**, both the movie file *and* an attached **captions `.vtt`** are
watched independently — see [Videos](videos.md).)

## Snapshots for export and print

Live elements — demos, notebooks, and videos — only render while their slide is
on screen, so a deck you open and export *without* clicking through every slide
can have gaps (placeholder boxes) in its exports, the print view, and the sidebar
thumbnails. Two **File menu** commands bake the live elements to static images
("snapshots") that the deck keeps:

- **Generate Missing Snapshots** — captures only the live elements that don't
  have a current snapshot yet. Run it before exporting a deck you haven't clicked
  all the way through. It's idempotent — a second run with nothing missing does
  nothing.
- **Refresh All Snapshots** — re-captures every live element (use it after you
  change a demo/notebook or switch the deck theme).

Both step through the slides behind a progress overlay and then restore your
place. The three export commands — **File → Export to HTML**, **Export Printable
HTML** (one slide per page, for the browser's Print-to-PDF), and **Export to PDF
(Screenshots)** — plus the sidebar thumbnails all read these snapshots, so a
snapshotted deck exports with real demo/notebook/video images instead of
placeholders.

## Why

Embedding makes decks portable; watching makes them live — most tools force you to
pick one. Eigendeck does both because the common case is "my plots come from code
and I tweak them up to talk time," and the failure case ("the script broke an hour
before the talk") is covered by the embedded bytes + version history, not by
hoping the file on disk is good.
