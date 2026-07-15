# Native Menu Bar

Eigendeck's native menu is built in `src-tauri/src/lib.rs` → `build_app_menu()`
(Tauri `MenuBuilder`). Every custom item has a stable **id** and emits a
`menu-event` that the frontend handles in `App.tsx` — the same ids on every
platform, so the same handlers run everywhere. Predefined items
(undo/copy/close-window/fullscreen/about/…) are Tauri built-ins.

The layout is **platform-native** via `#[cfg(target_os = "…")]` — it is deliberately
NOT the same on every OS. The common submenus are listed first; the platform table
after them covers what moves.

## Common submenus (all platforms)

- **File**: New Project (Cmd/Ctrl+N), Open Project (Cmd/Ctrl+O), Open Recent ▸, Save
  (Cmd/Ctrl+S), Save As… (⇧S), Import from HTML…, Export to HTML (⇧E) / Printable
  HTML… (⇧P) / PDF (Screenshots)…, Presentation Settings…, Compact (Free Unused
  Assets), Install LLM Tools…, Close Window.
- **Edit**: Undo, Redo, Cut, Copy, Paste, Paste without Formatting (`paste-plain`),
  Select All.
- **View**: Present Mode (F5), Screen Share Presentation, Present in This Window,
  Toggle Speaker Notes (⌥S), Toggle Inspector, History (⇧H), Snap to Grid / Show
  Grid Points (checkable), Hide Window Chrome (⇧F), Customize Toolbar…, Debug
  Console (⇧D), Developer Tools (⌥I), Fullscreen.
- **Insert**: every element type (Title/Body/Text Box/Note/Footnote/Card, Arrow/
  Cover/Image…/Hype/HTML Element/HTML from File…, Demo…/Notebook…/Video…) — always
  available regardless of which toolbar buttons are hidden. Ids mirror
  `src/lib/insertItems.ts` prefixed `insert-`.
- **Slide**: New Slide (⇧N), Duplicate Slide (Cmd/Ctrl+D), Delete Slide, Slide
  Properties, Presentation Properties.
- **Help**: Learning about Eigendeck, Manual, Report a Bug…

## Platform-specific placement (native to each OS)

| Item | macOS | Windows | Linux |
|------|-------|---------|-------|
| App-name menu ("Eigendeck") | Yes — About, Services, Hide/Hide Others/Show All, Settings…, Quit | *(none)* | *(none)* |
| Settings / Preferences | App menu → **Settings…** (⌘,) | **File → Settings…** (Ctrl+,) | **Edit → Preferences…** (Ctrl+,) |
| Quit / Exit | App menu → **Quit Eigendeck** (⌘Q) | **File → Exit** (Alt+F4, OS-level) | **File → Quit** (Ctrl+Q) |
| About | App menu → **About Eigendeck** | **Help → About Eigendeck** (bottom) | **Help → About Eigendeck** (bottom) |
| Window menu | Yes — Deck Security Settings, Minimize, Maximize, Close | *(none — title bar)* | *(none — title bar)* |
| Deck Security Settings | Window menu | **File** (by Presentation Settings) | **File** (by Presentation Settings) |

macOS-only predefined items (`services()`, `hide()`, the app menu, the Window menu)
are emitted only under `cfg(target_os = "macos")`. The About metadata (icon, author,
credits) is the same `AboutMetadataBuilder` everywhere — it feeds the macOS standard
About panel and the built-in Windows/Linux About dialog.

A **Debug** submenu is appended (before Help) only when launched with `--debug` (see
`debug::attach_submenu_if_enabled`).

## How it's wired

- **Add / change an item:** edit `build_app_menu()` in `src-tauri/src/lib.rs`. Give
  it a stable `id`; place it under the right `#[cfg]` if the position is
  platform-specific.
- **Handle a click:** the catch-all `menu-event` handler emits the id to the
  frontend; `App.tsx` routes it (insert ids → `runInsert`, others → their actions).
- **Keep ids stable:** the id is the contract between Rust and JS — the *label* and
  *placement* can differ per platform, the id must not.

## Verifying

- **Linux** (this container / CI): `cd src-tauri && cargo check && cargo clippy --
  -D warnings` compiles the shared + Linux/`not(macos)` branches; the `eigendeck-e2e`
  rig launches the real app, so a menu-build panic in `setup()` shows up as every
  probe failing to open.
- **macOS / Windows:** the Rust check in CI (`ci.yml`) runs on **Linux only**, so it
  does NOT compile the `cfg(target_os = "macos")` or `cfg(target_os = "windows")`
  branches. Those are validated by the per-OS **release build**
  (`.github/workflows/build.yml`) or a local `npm run tauri build` on that OS. A menu
  edit touching those branches should be sanity-built on the target OS before a
  release.
