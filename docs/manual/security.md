# Security: your files stay yours

> *Status: this describes Eigendeck's asset-security model. The Security Panel and
> the trust prompts below are being built to match it — this page is written first,
> so the design and the interface agree.*

## The rule

A `.eigendeck` is a file people email and share, like a PowerPoint or a Beamer
`.tex`. Eigendeck treats a deck you **received** differently from one you **made**:

- **A deck can always *show* its content.** Everything a deck carries is embedded
  inside it, so any deck opens fully and displays everything — nothing is hidden or
  blocked.
- **A deck can only *read live files off your computer* if you trust it.** Linking a
  slide to a file on disk (so it updates when you edit that file) is a real feature —
  but a deck you received can't do it until you say so, and you can always see
  exactly which files it wants.

**Decks you create are trusted. Decks you receive are not — until you decide.**

## Why this exists

An image you paste or insert is *embedded* — a copy lives in the deck. But a deck
can also *link* to a file that stays on disk and is re-read as it changes. That
convenience is also a risk: a malicious deck could link to one of your private files
(an SSH key, a credentials file), get your computer to read it in, and — because the
file's contents are now inside the deck — carry it out the next time you share the
deck. The person you send it to is the leak.

So Eigendeck draws the line at the **read**: it simply won't read a file off your
disk that you didn't approve. Get that right and there's nothing to leak, no matter
who you send the deck to.

Two consequences you'll feel:

- **If you never link external files, you'll never see any of this.** Insert or
  paste your images (they embed) and there is nothing to watch and no prompts —
  ever. This is most people.
- **Eigendeck can only ever watch presentation files.** Images, PDFs, videos,
  notebooks, and demos — the things a slide is made of. A deck can *never* get you
  to watch your SSH key or a credentials file; those aren't presentation content, so
  they're refused outright, before you're even asked.

## How it respects your data

- **Your source files are never modified.** Watching reads them; it never writes
  them. (Notebooks work the same way — see [Notebooks](notebooks.md).)
- **Sharing a deck never sends anything anywhere on its own.** A deck doesn't phone
  home; the only way content leaves your machine is you sending the deck.
- **Exported HTML has no live links.** Everything is baked in as static content, so
  an exported deck carries no connection back to your disk.

## How it respects your time

Security you have to click through constantly is security you stop reading — so
Eigendeck keeps out of your way:

- **No pop-ups when you open a deck.** A received deck just opens and shows its
  content; live-watching is simply off until you choose to turn it on.
- **You approve once, and it sticks.** When you trust a deck you review its linked
  files *once*; after that they just work.
- **Trust fades gently, not abruptly.** A deck you keep using stays trusted. One you
  haven't opened in about a month asks you to re-confirm — a single click that
  restores everything, surfaced as a quiet notice, never a blocking dialog.

## The Security Panel

When a deck links to external files, you manage them in the **Security Panel** — a
window that lists, for the deck:

- every external file it links to, and **where each one is used** (which slide /
  element);
- **the real file each link points to** (resolved in full, so a link can't disguise
  where it actually goes);
- whether each is **watched**, **awaiting your approval**, or **refused** (not a
  presentation file).

There are two steps, and they're separate on purpose. First you **Trust this deck** —
a one-time decision that unlocks watching and, by itself, reads nothing. Then you
**approve the files** you actually want watched — one at a time, or a whole folder at
once. (There's no single "trust everything" button; trusting the deck and choosing its
files are deliberately two decisions.) Refused files are shown so you understand what a
deck tried to reach, but they can't be approved. You can also see a single file's status
right in its **inspector** when you select that element on the canvas.

## Working with a deck someone sent you

1. **Open it.** It displays completely — every image, demo, and notebook. Nothing is
   hidden.
2. **If you want its linked files to stay live** (update as they change on disk),
   open the Security Panel, click **Trust this deck**, then approve the files (or whole
   folders) you recognise. Until then it shows the embedded copies it came with.
3. **If a link points somewhere you don't expect**, don't approve it — the panel
   shows you the real destination precisely so you can catch that.
4. **Later, if it asks you to re-confirm** (about a month on), that's the trust
   timer; one click brings it back.

If you'd rather not deal with live files at all, turn off file-watching globally in
Settings — then decks are always self-contained copies and none of this appears.

## Related

- **[Watched assets](assets.md)** — how linking + watching works day to day.
- **[Sync and link](sync-and-link.md)** — relating elements across slides (a
  different meaning of "link").
- **[Notebooks](notebooks.md)** — recording and editing without touching your source.
