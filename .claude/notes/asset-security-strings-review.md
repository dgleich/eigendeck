# Asset-security UI strings — review

Every user-facing string in the asset-security UX, grouped by where it appears.
**How to use:** edit the text on the `▸` line in place (or add a `NOTE:` under any
entry). Leave one alone to keep it. Ping me when you're done and I'll apply the changes.

Legend for `{…}`: runtime values (counts, extensions, paths) — keep the braces.
Curly apostrophes (’) are intentional (typographic); keep or change as you like.

---

## 1. Security window  (SecurityPanel.tsx / Window → Deck Security Settings)

S1  window title
  ▸ Security & linked files 
COMMENT: This may have other security related features for HTML/Javascript, so let's keep it flexible.   

S2  intro paragraph
  ▸ Eigendeck has a file watching feature that enables links to files on your computer.   
This feature presents a small security risk because it will copy the contents of any
linked file into the deck. We don't want your file contents to be shared without your 
explicit permission. 
[This deck includes these links | This deck does not include any links.] 

Enabling trust or file watching is not necessary to look at the deck contents, which includes
a copy of all everything already embedded. You can do everything except using these
watched file links with an untrusted deck. 

COMMENT: Need some branching here depending on what scenario we are in. ... Did we create the deck? Did we previously approve it? 

CASE: The deck doesn't appear in our security ledger at all or expired. 
When you receive a deck from someone else, we don't recognize it, or the approval has lapsed,
Eigendeck needs you to approve trusting that deck to enable the file watching behavior at all. 

CASE: Did we create the deck?
This system created the eigendeck file on XXXX. [more on the scenario prompting it... ]

CASE: Did we previously trust the deck? 

Don't show the path we store unless it traverses a symlink. i.e. if the ../../ sequence 

Files accessed: 
[This deck has watching turned off | You have turned watching off,
... need more explaination here. This is an important screen. 

  ▸ This deck includes links to files on your computer. By default, shows the copy embedded in the deck. Approve only files you recognize; check the real target shown for each.
Somewhere on the page... Right now, there are [x] links approved and [y] files being watched. 

S3  still scanning
  ▸ Scanning…
COMMENT: Where does this occur? 

S4  deck has no external links
  ▸ This deck has no linked external files — everything is embedded.

S5  untrusted banner (shown until the deck is trusted)
  ▸ This deck isn’t trusted, so Eigendeck isn’t reading any of these files — you’re seeing the embedded copies. Trust the deck to choose which files it may read & watch. Trusting reads nothing on its own; you approve files next.

S6  trust button
  ▸ Trust this deck

S7  bulk-approve section heading (trusted deck)
  ▸ Approve a whole folder:

S8  bulk-approve button  ({N} = count, {dir} = folder path)
  ▸ Approve all {N} files in {dir}

S9  per-file approve button
  ▸ Approve

S10 eligible row while still untrusted (in place of Approve)
  ▸ trust the deck first

S11 footer note
  ▸ Blocked files aren’t a watchable type (e.g. not an image/PDF/video) and can’t be approved.
  
S12 state badges (the coloured pill on each row)
  ▸ Watched
  ▸ Not watched
  ▸ Missing
  ▸ Blocked 
  
COMMENT: 
Need a "revoke approval" button. 
Need a "stop trusting this deck" button. 

---

## 2. Asset inspector  (AssetSection.tsx — shown for a selected image/video/etc.)

A1  source-file field label
  ▸ Source file

A2  no linked source
  ▸ Embedded snapshot — no linked source file

A3  untrusted nudge (only when watching is on)
  ▸ This deck isn’t trusted, so its linked files don’t live-update — you’re seeing the embedded snapshot. Trust the deck & approve files in the Security window to enable updates.

A4  review link (also shown quietly on any linked asset)
  ▸ Review linked files…

A5  missing-source alert
  ▸ ⚠ Source file is missing from disk. Showing the last-loaded snapshot — edits to the original won’t appear until you relocate it.

A6  relocate button
  ▸ Relocate…

A7  per-asset watch checkbox
  ▸ Watch this file for changes

A8  per-asset watch captions (which one shows depends on why it's on/off)
  ▸ Untrusted decks can’t watch assets. Approve this file in Window → Deck Security Settings.
  ▸ Disabled because the global setting (Cmd+,) is off.
  ▸ Disabled because watching is turned off for this presentation.
  ▸ Off: file changes don’t update this image.
  ▸ Off: file changes don’t update any of the {N} copies.
  ▸ On: file changes update this image.
  ▸ On: file changes update all {N} copies of this image.

A9  reload button (idle / working)
  ▸ Reload from disk now
  ▸ Reloading…

A10 relocate file-picker dialog title
  ▸ Locate source file

---

## 3. Deck inspector  (PropertiesPanel.tsx → Deck tab)

D1  Security entry button
  ▸ Linked files & security…

D2  Security entry tooltip
  ▸ Review which files on your computer this deck links to, and approve or block them

D3  deck-level watch checkbox label  (struck through when untrusted)
  ▸ Watch source files for changes

D4  deck-level watch captions
  ▸ Untrusted decks can’t watch assets. Approve files in Window → Deck Security Settings to enable this.
  ▸ Disabled because the global setting (Cmd+,) is off.
  ▸ Off: nothing in this presentation auto-updates when source files change.
  ▸ On: linked SVG / image assets reload when their source files change on disk.

---

## 4. Adding a file that's rejected  (assetInsert.ts — toast)

R1  extension not on the allowlist  ({ext})
  ▸ “{ext}” isn’t a supported asset type. Eigendeck supports images, PDFs, videos, notebooks, captions, and demos.

R2  .html that isn't an Eigendeck demo
  ▸ That .html isn’t an Eigendeck demo, so it can’t be added. Only demos authored for Eigendeck can be embedded (see DEMO_AUTHORING) — an arbitrary web page or HTML file can’t.

R3  bytes don't match the extension  ({EXT})
  ▸ That file isn’t a valid {EXT} (its contents don’t match its name), so it can’t be added.

R4  demo built for a newer Eigendeck
  ▸ This demo was built for a newer version of Eigendeck and can’t be added here.

R5  add succeeded but deck isn't saved yet (no watching until saved)
  ▸ Asset added, but file-watching is disabled until the presentation is saved. Save now, then re-add to enable live updates from the source file.

R6  generic add failure
  ▸ That file couldn’t be added.

---

## 5. Toasts (transient notifications)

T1  reload attempted on an untrusted deck  (AssetSection)
  ▸ This deck isn’t trusted, so reloading from disk is off. Trust the deck to enable live updates.

T2  relocate refused (untrusted or wrong type)  (AssetSection)
  ▸ Can’t link that file: either this deck isn’t trusted, or the file isn’t a supported asset type.

T3  relocate — file unreadable  (AssetSection)
  ▸ Couldn’t read that file.

T4  relocate — siblings auto-relocated  ({N})  (AssetSection)
  ▸ Relocated {N} more files in the same folder.

T5  on open — trust lapsed after 30 days (with a "Re-confirm" button)  (fileOps)
  ▸ This deck’s trust expired — re-confirm to resume watching its linked files.
     button ▸ Re-confirm

T6  after re-confirm succeeds  (fileOps)
  ▸ Trust restored — linked files will live-update again.

T7  on open — trusted deck has unapproved linked files (with a "Review" button)  ({N})  (fileOps)
  ▸ {N} linked files aren’t watched — review to approve.
     button ▸ Review

T8  trust success via the e2e seam path (rarely user-visible)  (fileOps)
  ▸ Deck trusted — its linked files will now live-update.

---

## 6. Native menu  (lib.rs)

M1  Window menu item that opens the Security window
  ▸ Deck Security Settings

---

## Open naming question (from the design doc's "to decide later")
- The Forbidden state is labelled **Blocked** (S12). Alternatives floated: "Off-limits",
  "Denied". Pick one:  ▸ Blocked
