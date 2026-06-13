# Eigendeck manual

A user-facing guide to the design choices that shape how you build
talks in Eigendeck. Different from `DESIGN_DECISIONS.md` and the
other top-level `*.md` docs — those explain implementation choices
to people reading the code. The manual explains *editorial* choices
to people building presentations.

## Topics

- [Text sizes](text-sizes.md) — the named scale and why slide-level
  overrides don't exist.
- [Sync and link](sync-and-link.md) — the two ways to relate elements
  across slides (sync unifies, link animates), the duplicate→free→move
  animation workflow, the S/A badges, promoting a link to a sync, and
  what copy/paste does.
- [Notebooks](notebooks.md) — embedding Jupyter notebooks, the in-deck
  recording (your source file is never touched), editable vs.
  file-watching, display options, and syncing a notebook across slides.
- [Jupyter servers](notebook-servers.md) — the per-machine kernel-
  server registry, why deck files don't carry URLs or tokens, and
  how the topbar status pill works.
- [Videos](videos.md) — local video files (embedded + watched) vs.
  YouTube/Vimeo/PeerTube embeds, the playback options (loop, ping-pong,
  speed, autoplay, controls, muted, captions), and how thumbnails/export
  work.

(More topics are added as design decisions get nailed down.)

## How to read this

Each topic page starts with the rule (what the tool does), then the
reasoning (why it does that), then the workflow (how to live with
it well). If a topic explains a constraint you find frustrating,
read past the rule — the reasoning is usually the point.
