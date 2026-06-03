# Notebook recording/overlay — design discussion log

Running log of the issues we debated and how each resolved. Companion
to `notebook-recording-plan.md` (the build plan) and
`notebook-recording-test-plan.md` (the test matrix). Newest decisions
near the bottom of each section.

## 1. Editable semantics (the two-axis untangle)

- First attempt coupled "can edit" with "edits persist" via one
  `editable` toggle. Broke the classroom-teacher case (editable off →
  can't tweak `k=5→k=10` live).
- Resolved: **two independent axes.**
  - `editable` = can cells be typed into. ▶ Run always works regardless.
  - persistence is a SEPARATE question (see §2).
- A coupling we DID keep: turning `editable` on disables file-watching
  for the asset (`auto_reload='off'`), so in-deck edits aren't clobbered
  by a disk reload. external_path stays → manual reload still works.

## 2. Persistence: "not an editor, but a recorder"

- eigendeck must NEVER mutate the user's `.ipynb` (authored in
  JupyterLab). So it's *not an editor* of the source.
- But it IS a *recorder*: outputs are produced HERE by running; nowhere
  else has them. So eigendeck should persist them.
- The asymmetry: **source = authored elsewhere (pristine); outputs (and
  in-deck tweaks) = recorded into a per-element overlay.**
- "Live" was briefly a criterion, then DROPPED — it did no work (CSV
  view-state could be set while authoring, not just live).

## 3. Where the overlay lives — the long one

Candidates considered, in order:
- **(a) inline in `element.data`** — simplest, but `elements` is a
  TEMPORAL table: the whole `data` blob is rewritten as a new version
  on ANY element change (even moving the box). A 1–10 MB output there
  thrashes history. Rejected for large outputs.
- **(b) recording-as-its-own-asset (`recordingAssetId` on element)** —
  reviewed; 3 structural blockers (see §4). The "two assetIds on one
  element" also smelled (§5).
- **(c) junction table `element_assets(element_id, role, asset_id)`** —
  the ∞ arm of 0/1/∞; general (element → N shared assets). Right tool
  for COMPOSITION (galleries, multi-file demos), but overkill now and a
  bigger contract change.
- **(d) `assets.owner_element_id` column — CHOSEN.** The overlay is an
  eigendeck-owned asset tagged with the element that owns it. Element
  still references ONE asset (the `.ipynb`); overlay is *discovered* by
  query, not declared. Reuses asset versioning/storage; isolates big
  outputs from element-row churn.

## 4. The 3 blockers (why recording-as-asset needed hardening)

Review found, against the code:
- **B1 GC** — orphan-GC reachability only checked `elements.asset_id`;
  an overlay (not referenced there) would be deleted by Compact.
  → fixed structurally: GC also keeps assets whose `owner_element_id`
  is a live element.
- **B2 duplicate** — `duplicateSlide` deep-clones but would copy the
  overlay reference → two elements share one overlay → cross-mutation.
  → clone the overlay on duplicate (caller-side, P5).
- **B3 dedup** — `db_store_asset` hash-dedups; two empty overlays
  collapse to one asset. → always create overlays with an explicit
  client-minted asset_id (never the path-lookup branch).

## 5. The 0/1/∞ objection

- "Two assets per element" violates zero/one/infinity. The blockers
  were the asset system *telling us* an element doesn't get a second
  asset slot.
- `owner_element_id` resolves it: element declares ONE asset; the
  overlay is a discovered owned sidecar (asset-side ownership), not a
  second element→asset slot.

## 6. When is `owner_element_id` actually warranted? (criterion refinement)

Successive sharpening as we stress-tested:
- v1: "secondary asset alongside a primary" — too broad.
- v2: "a private overlay of a SHARED source, authored in-app, that
  can't go back into the source."
- The decisive test: **"could this asset be its own element?"**
  - Yes → make it its own element (audio narration = hidden audio
    element; chart snapshot = an image element). NOT owner.
  - No → unpromotable sidecar bound to a parent's identity/rendering →
    owner. (Notebook overlay overlays cells by index, renders merged,
    has no standalone existence.)
- Second discriminator (owner-ASSET vs inline `element.data`): **size /
  versioning.** Small declarative prefs → inline. Large or
  independently-versioned payload → owned asset. Notebook outputs
  (1–10 MB) force the asset.

## 7. Use cases stress-tested (justifying the primitive)

- **Notebook** — genuine: `.ipynb` + overlay (edits/outputs/appended).
- **Poll + results** — clean parallel (definition + accumulated votes).
- **Demo state** — plausible but state is arbitrary JS, hard to record;
  deferred.
- **Dataset table** — clean: CSV + recordable view-state
  (sort/filter/highlight/what-if). But small prefs → inline, not owner.
- **The reframe that actually justifies the investment:** this isn't a
  Jupyter feature, it's a **live-code element** substrate. Same infra
  (source asset + overlay + runtime abstraction) backs Jupyter
  (local/lite/Colab=remote), Observable, plain REPL. `owner_element_id`
  is the persistence layer for that category. Build the foundation now,
  ship Jupyter as backend #1, add backends later.

## 8. Naming

- **Schema (durable, general):** `assets.owner_element_id` (ownership
  relationship, not content); overlay mime
  `application/x-eigendeck-overlay+json`. No "notebook" in schema.
- **UI / element type:** stays `'notebook'` (only scenario today);
  generalize when a 2nd backend lands.
- **Concept/data:** "overlay" (what `mergeNotebook` does).
- Rejected: `session` (collides with Jupyter kernel sessions);
  `recordingAssetId` field on element (replaced by owner discovery).

## 9. Save As asset-wipe bug (found during review)

- `db_import_json` intentionally wipes the `assets` table; Save As calls
  it before `db_save_to_file`, so Save As writes an asset-less file
  (loses images/PDFs/.ipynb AND would lose overlays). Pre-existing, not
  caused by this feature.
- Filed: **github.com/dgleich/eigendeck/issues/65**. Fix = Save As uses
  `db_save_to_file` directly (no destructive `db_import_json`
  round-trip). Sequenced as separate; recording work proceeds.

## 10. Final model (locked)

- Notebook element → one `.ipynb` asset (`asset_id`, may be watched,
  pristine).
- Overlay = eigendeck-owned asset, mime overlay+json,
  `owner_element_id` = element id, external_path NULL, auto_reload off,
  created with explicit UUID, discovered by
  `db_get_owned_asset_id(elementId)`.
- Overlay data (`Overlay` type): `cellEdits`, `cellOutputs`,
  `cellCounts`, `appendedCells`. Merged over the parsed `.ipynb` by
  `mergeNotebook`.
- Outputs record passively on run (regardless of editable). Source
  edits record when editable. Flush to a new overlay version on deck
  save, only-when-changed. Reload-from-disk clears the overlay.
- GC keeps overlays of live elements; dedup skipped via explicit id;
  cloned on duplicate.

## A. Process — how we actually made these calls

The decisions above didn't come from picking the first reasonable
option; they came from a few repeated moves worth remembering:

- **Stress-test by use case, not by the feature in hand.** We refused
  to justify `owner_element_id` on notebooks alone — we generated
  future element types (poll, demo, dataset table, audio narration,
  ink) and ran each through the criteria. That's what exposed that the
  "family" was thinner than first claimed, and ultimately what
  reframed the whole thing as a *live-code platform* (§7).
- **Criterion-by-challenge.** Every proposed rule got attacked until it
  survived. "Why is ink owner?" → it isn't (it's its own element).
  "Why are these *live*?" → they're not; drop "live." "Poll+results is
  the closest" → yes, and it sharpened the rule. The criterion evolved
  through ~4 rounds: secondary-asset → per-instance-overlay-of-shared-
  source → **"can it be its own element?"** → size/versioning. Each
  round discarded a wrong framing.
- **Heuristics we leaned on:** 0/1/∞ (the "two assets" smell);
  "not an editor, but a recorder"; reuse-existing-infra over reinvent
  (favored the asset table over a parallel recordings table); additive/
  low-risk over big-bang (owner column vs junction-table contract
  change).
- **Review agents against the REAL code, twice.** We didn't trust the
  design in the abstract — review agents read storage.rs/GC/dedup/
  duplication and reported what would actually break. That's how the 3
  blockers (GC delete, duplicate-share, dedup-collapse) AND the
  unrelated Save As asset-wipe bug surfaced. Verifying claims against
  file:line beat reasoning from memory.
- **Tests before wiring.** An aggressive test agent wrote 72 merge
  tests + an integration matrix before we built P2+, so the merge
  engine was pinned (and 5 sharp edges documented) before anything
  depended on it.
- **Cheap reverts.** Branched `feat/notebook-recording` so the whole
  structural change can be dropped as a unit if it doesn't pan out.
- **Scope discipline.** Build the foundation now; defer speculative
  generality (the junction table) until a real composition element
  arrives; ship Jupyter as backend #1 and leave Observable/Colab as
  plug-ins rather than building them on spec.
- **Separate durable from cosmetic.** Schema names kept general
  (`owner_element_id`, overlay mime) so "notebook" never enters the
  durable schema; UI/element-type names kept specific because there's
  only one scenario today.

## B. Alternatives considered (consolidated)

| Question | Chosen | Rejected alternatives | Why rejected |
|---|---|---|---|
| Where the overlay lives | `assets.owner_element_id` (owned asset) | inline `element.data` | temporal `elements` rewrites the whole blob on any edit → 1–10 MB output churns history |
| | | `recordingAssetId` (2nd asset on element) | 0/1/∞ smell + 3 structural blockers |
| | | junction `element_assets` | overkill; composition need hasn't arrived |
| | | dedicated `recordings` table | reinvents asset versioning/storage |
| Edit model | two axes: `editable` (can-edit) ⟂ persistence | one toggle gating both | classroom teacher needs editable-but-ephemeral |
| Persistence | passive record (outputs always, edits when editable) | auto-persist source to asset history | "recorder not editor" — don't rewrite the source |
| | | explicit capture buttons everywhere | too much ceremony |
| Disk-change conflict | coarse: reload clears the whole overlay | per-cell merge | unworkable when cells reorder ("cases change entirely") |
| Naming (data) | "overlay" | "session" | collides with Jupyter kernel sessions |
| | | "recording" | audio/video connotation |
| What needs an owned sidecar | "can't be its own element" + large/versioned | "any secondary asset" / "any recorder" | most secondaries can be their own element (audio, snapshot) or are small enough to inline |

## 11. Status

- **P1** (data model + merge lib) — done, committed.
- **P1.5** (backend: `owner_element_id` column, `db_store_asset` owner
  param, GC clause, `db_get_owned_asset_id`, doc) — done + verified
  in-container (cargo check / clippy -D warnings / storage tests
  --test-threads=1 all green). Commits e9d61f0, d07042e.
- **P2–P6** — TS/React: merge display + visual distinction, passive
  record + flush, source edits + migration of legacy `cellEdits`,
  appended cells + CRUD UI, docs + the "can it be its own element?"
  criterion into DESIGN_DECISIONS.
