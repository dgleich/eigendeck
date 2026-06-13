# Videos

## The rule

A **video element** puts a movie on a slide. There are two kinds:

- **A local file** — pick a video file (mp4 / webm / mov / …) or **drag it onto
  the canvas**. The bytes are embedded in the deck, exactly like an image, so the
  deck stays self-contained. (Videos are big: Eigendeck warns before embedding
  anything over **250 MB**.) The file is also **watched** — re-export or replace
  it on disk and the slide reloads it.
- **An embed by URL** — paste a **YouTube, Vimeo, or PeerTube** link. Nothing is
  downloaded into the deck; the provider's player is embedded and the video
  streams at play time (so embeds need a network connection when you present).

Add either with the **"+ Video"** button (it asks for a file or a URL) or by
dragging a video file in.

## Playback options

In the Inspector (select the video):

- **Loop** — play forever.
- **Ping-pong** — *files only:* play forward, then backward, repeat. This is
  best-effort — video has no true reverse playback, so it's smooth only for
  **short clips** (it reverse-seeks frame by frame).
- **Speed** — 0.25×–2×. For files this is exact; for embeds it's applied through
  each provider's player API, so treat it as best-effort.
- **Autoplay** — start when the slide appears in present mode. Browsers only
  allow autoplay when **muted**, so autoplay forces mute.
- **Show controls** — show the player's controls bar. Off by default (a slide
  video is usually chrome-free; in the editor, click it to play/pause).
- **Muted** — start with sound off.
- **Captions** — *files:* attach a **WebVTT (`.vtt`)** subtitle file (browsers
  can't read subtitles baked into the video container, so captions come from this
  sidecar). *Embeds:* turns on the provider's captions, best-effort.

All toggles are **off** by default and speed defaults to **1×**.

## Thumbnails and export

The slide-sidebar thumbnail shows a **poster frame** of a file video (captured
automatically) or the **provider thumbnail** of an embed. Static/PDF export uses
that same cached image — so a file video exports as its poster frame with no
slide flip-through. Embeds can't be screenshotted offline (cross-origin), so in
an offline export they fall back to a placeholder box.

## Why

Local files are embedded (not linked) so a deck you hand to someone else just
works — same reasoning as images. Embeds are the opposite trade: tiny deck, but
they depend on the network and the provider. Pick by how you'll present.

Reverse playback and embed speed are "best-effort" on purpose: the browser
doesn't give us a clean way to do either, so rather than hide the options we
expose them and tell you the limits here.
