# Contributing to Eigendeck

Thanks for your interest in Eigendeck! It's a tool for building talks with
embedded interactive demos and real math, built by and for people who give a lot
of technical presentations. There are three kinds of contribution we're actively
looking for — each works a little differently.

## 1. Report bugs

The most valuable thing you can send us is a clear bug report. We especially want
to hear about two classes of problem:

- **Data loss** — anything where you lost work, a deck failed to save or reopen,
  an export dropped content, or an edit couldn't be undone. These are top
  priority.
- **UI jank** — visible glitches, flicker, layout shifts, a "pop" as content
  appears, sluggish dragging, things that don't line up, etc.

A good report has three parts:

1. **What you did** — the steps to get there (which deck, which element, what you
   clicked).
2. **What you expected to happen.**
3. **What actually happened** — including a screenshot or screen recording if it's
   visual, and the exact text of any error.

File it at **[github.com/dgleich/eigendeck/issues](https://github.com/dgleich/eigendeck/issues)**
(or **Help → Report a Bug…** in the app). Before opening a new one, a quick search
for an existing issue helps us de-duplicate.

## 2. Customize Eigendeck to how *you* present

Everyone gives talks a little differently, and our long-term goal is to make
Eigendeck deeply customizable — the way Emacs is — so it can fit your workflow
rather than forcing one on you. We're still figuring out *what* is most worth
making customizable and *how* to expose it cleanly, so the customization surface
isn't settled yet.

In the meantime, **the best way to customize Eigendeck today is to maintain your
own fork.** Rather than trying to merge a pull request for every individual
tweak — which would pull the core in too many directions at once — we keep a
**list of community forks** in **[FORKS.md](FORKS.md)** so people can find one
that matches how they work and contribute to it directly. This also helps us see
which customizations are popular enough to pull back into core.

If you maintain a fork, add it to [FORKS.md](FORKS.md) via a pull request. And if
you have ideas about which parts of Eigendeck should become first-class
customization points, open an issue describing your presentation workflow and
what gets in your way — that's exactly the input we need to prioritize.

## 3. Build plug-ins for new slide elements

Eigendeck slides are made of elements (text, image, demo, notebook, video,
cover, …), and we want a **plug-in ecosystem** so the community can add new
*kinds* of element — whatever you'd like to put on a slide that we don't ship.
Contributions of new element types are expected and welcome.

The plug-in interface is still being defined. If you have an element type in mind,
open an issue to start the conversation — concrete use cases drive the design of
the extension API. (For interactive HTML demos *today*, see `DEMO_AUTHORING.md`,
which already lets you drop custom interactive content onto a slide.)

## Building from source

See `README.md` for prerequisites and build commands (`npm install`,
`npm run setup`, `npm run tauri dev`). Run `npm test` before sending changes.

---

However you contribute — a sharp bug report, a fork others can use, or a new
element type — thank you. It genuinely helps.
