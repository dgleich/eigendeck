# Cut, copy, and paste

## The rule

What a paste does depends on **where** you paste and **what's on the clipboard**.

**Pasting onto the canvas** (nothing being edited) adds a new element:

- **An image, SVG, or PDF** copied from another app (Excel, Pages, Preview, a
  browser, a screenshot) → inserted as an image element. Eigendeck reads the
  richest form available, preferring **vector (SVG) → PDF → PNG/JPEG**, so a
  chart copied from Office comes in as crisp vector art rather than a bitmap when
  the app offers both.
- **A file copied in Finder / Explorer / Files** (select an image, SVG, or PDF
  file in the file manager and copy it) → inserted from the file's bytes, exactly
  like dragging the file onto the slide.
- **Rich HTML** with no image on the clipboard — a **Google Sheets / Excel
  range, a Google Docs or Word selection, a chunk of a web page** → Eigendeck
  renders that HTML **in your deck's font** and drops it in as a **picture**
  (see below). This is how you get a spreadsheet table onto a slide.
- Otherwise (plain text only) → nothing is added to the canvas; paste into a
  text box instead.

**Pasting into a text box** (double-click to edit first) inserts **text**.
Formatting from outside Eigendeck is dropped — you get clean plain text in the
box's own style — *unless* the clipboard came from Eigendeck itself (copying a
selection inside another text box keeps its bold/italic/super-/subscript/color).

Copying and pasting **whole elements** (select, ⌘C, ⌘V) duplicates them; across
slides this is also how you set up animations — see
[Sync and link](sync-and-link.md).

## HTML pastes become a picture

When you paste a table or other formatted HTML onto the canvas, Eigendeck:

1. lays the HTML out in your **deck body font** (so it looks on-brand, not like
   whatever font the source used), then
2. **screenshots it to an image** and inserts that, centered.

So a pasted table is a normal image element: it scales, moves, exports, and
shows up in thumbnails like any other picture — no live spreadsheet, no surprise
reflow when you present.

What carries over: the cell text, **bold / italic**, text and background colors,
alignment, and the **borders you actually set** in the source. What's
intentionally replaced: the **typeface** (always your deck font).

One honest caveat for Google Sheets: Sheets includes its faint **default
gridlines** in the copied HTML even when you haven't set any borders, so an
"unbordered" range pastes *with* that light grey grid. To control the lines,
set (or clear) real borders in Sheets before copying — those render exactly as
you set them.

## The reasoning

A picture, not a live table, is a deliberate choice. A slide needs to look the
same every time you present it and when you export to PDF or HTML; a rasterized
snapshot is frozen and predictable, and it travels inside the deck with no
external dependency. Rendering through the browser (rather than re-implementing
spreadsheet layout) means *any* HTML works — lists, headings, quotes, mixed
formatting — not just one app's tables. Forcing the deck font keeps pasted
content consistent with the rest of your slides.

## Workflow

- **Spreadsheet table:** select the range in Sheets/Excel, copy, click the slide
  (don't be editing a text box), paste. Resize the resulting image like any
  picture.
- **Want specific lines:** set the borders in the spreadsheet first; clear them
  for a borderless look (mind the Sheets default-gridline caveat above).
- **Updating a pasted table:** it's a snapshot, so re-copy from the source and
  paste again to replace it.
- **Just the text, no styling:** paste into a text box instead of onto the
  canvas, or use **Paste as… → Text**.
