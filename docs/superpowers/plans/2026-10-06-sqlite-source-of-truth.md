# SQLite Is the Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-memory store a working copy of SQLite's model (one id per element, synced derived, dirty slides written whole) so the sync/persistence bugs #194–#201 go away.

**Architecture:** A synced element gets the same id (its row id) on every slide that shows it. `syncId` is computed after every store change from "this id appears on more than one slide". The save stops inferring element adds/deletes from snapshot diffs; for each slide whose elements changed it calls one Rust command that upserts those rows and sets that slide's junctions exactly, plus one command for the slide list.

**Tech Stack:** React/TS + Zustand/zundo (`src/store/presentation.ts`), Rust/rusqlite (`src-tauri/src/storage.rs`), Vitest (+ node:sqlite fake backend in `src/store/syncHunt.test.ts`), the e2e rig (`e2e/run-all.sh`).

**Spec:** `docs/sync-and-link.md`, section "Addendum: SQLite is the source of truth".

## Global Constraints

- No schema change and no migration: tables and columns stay exactly as they are (`link_id` stays on `elements`).
- Rust `rust-version = "1.85"`; Node is CI's `lts/*`.
- Commit format per AGENTS.md (`type(scope): summary`, prose body, the harness trailer); never backticks in `git commit -m` (use `-F -`).
- Gates per AGENTS.md: `npx tsc --noEmit`, `npx vitest run`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test --lib -- --test-threads=1` (cargo needs `export PATH="$HOME/.cargo/bin:$PATH"; export CARGO_TARGET_DIR="$HOME/el-target"`).
- `cargo fmt --check` has 452 lines of pre-existing drift; new Rust code must not add to it (check with the worktree comparison used in 285bca9's verification).
- Every existing test whose expectation changes because of rule 1 (ids) must be listed in that task's commit message with the reason; never silently edited.
- `dist/` for e2e must be built with `VITE_EIGENDECK_SEAM=1 npm run build`.

## Review Focus

1. **A synced edit on a big deck** should write only the slides that show that element, not every slide. Test in Task 2: a 50-slide deck, one synced element on 3 slides, one edit → exactly 3 `db_write_slide` calls.
2. **Decks already damaged by #195** (two current rows or two junctions for one element, as in `gitignore/source-inversion.eigendeck`) should heal when the slide is written, not fail. Test in Task 1: Rust test seeds a duplicate current row and a duplicate junction, writes the slide, asserts exactly one of each.
3. **Notebook recordings after duplicate and free** must stay with the right element (overlays are keyed by `syncId ?? id`). Test in Task 2: duplicate a notebook slide, free the copy, the freed copy's overlay key is its new id and the original's is unchanged.
4. **Pasting from a different deck** (including a Save-As copy that shares ids) must never join a sync group in this deck. Test in Task 3: a clip with another deck's token pastes as an independent copy even when its element id exists here.
5. **A text edit that commits after switching slides** (#177) must still land on the element. Test in Task 2: commit `updateElement` for an element on slide 1 while slide 2 is current; slide 1 gets it.

---

### Task 1: Storage commands for whole-slide writes, and the loader fix (#199)

**Files:**
- Modify: `src-tauri/src/storage.rs` (new commands next to `db_update_z_order` ~1995; loader junction query ~1054; tests in `mod tests` ~3030)
- Modify: `src-tauri/src/lib.rs` (register commands in the `invoke_handler` list, ~1076)
- Modify: `src/store/syncHunt.test.ts` (fake backend: two new `case`s, and the loader's junction query)

**Interfaces:**
- Produces: Tauri `db_set_slides({ slides: { id, position, notes, groupId, config }[] })` and `db_write_slide({ slideId, elements: { id, type, data, linkId, assetId }[] })`. `config` is a JSON string or `''` (stored as NULL). Both idempotent; both bitemporal (close the current version, insert a new one) and both write nothing when nothing changed.

- [ ] **Step 1: Write the failing Rust tests** (in `storage.rs` `mod tests`, using the existing test DB helpers in that module):

```rust
#[test]
fn test_write_slide_upserts_rows_and_sets_junctions_exactly() {
    setup_test_db();
    db_set_slides(vec![SlideWrite { id: "s1".into(), position: 0, notes: String::new(), group_id: None, config: String::new() }]).unwrap();
    let a = ElementWrite { id: "A".into(), el_type: "text".into(), data: r#"{"html":"a"}"#.into(), link_id: None, asset_id: None };
    let b = ElementWrite { id: "B".into(), el_type: "text".into(), data: r#"{"html":"b"}"#.into(), link_id: Some("L".into()), asset_id: None };
    db_write_slide("s1".into(), vec![a.clone(), b.clone()]).unwrap();
    db_write_slide("s1".into(), vec![a.clone(), b.clone()]).unwrap(); // idempotent
    with_db(|c| {
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM elements", [], |r| r.get(0))?;
        assert_eq!(rows, 2, "second identical write must not add versions");
        let js: Vec<(String, i32)> = c.prepare("SELECT element_id, z_order FROM slide_elements WHERE slide_id='s1' AND valid_to IS NULL ORDER BY z_order")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        assert_eq!(js, vec![("A".into(), 0), ("B".into(), 1)]);
        Ok(())
    }).unwrap();
    // reorder + drop A + change B's data
    let b2 = ElementWrite { data: r#"{"html":"B2"}"#.into(), ..b };
    db_write_slide("s1".into(), vec![b2]).unwrap();
    with_db(|c| {
        let live: Vec<(String, i32)> = c.prepare("SELECT element_id, z_order FROM slide_elements WHERE slide_id='s1' AND valid_to IS NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        assert_eq!(live, vec![("B".into(), 0)]);
        let data: String = c.query_row("SELECT data FROM elements WHERE id='B' AND valid_to IS NULL", [], |r| r.get(0))?;
        assert_eq!(data, r#"{"html":"B2"}"#);
        let a_live: i64 = c.query_row("SELECT COUNT(*) FROM elements WHERE id='A' AND valid_to IS NULL", [], |r| r.get(0))?;
        assert_eq!(a_live, 1, "an unreferenced row is left alone, like any deleted element");
        Ok(())
    }).unwrap();
}

#[test]
fn test_write_slide_heals_duplicate_rows_and_junctions() {
    setup_test_db();
    db_set_slides(vec![SlideWrite { id: "s1".into(), position: 0, notes: String::new(), group_id: None, config: String::new() }]).unwrap();
    with_db(|c| {
        for _ in 0..2 {
            c.execute("INSERT INTO elements (id,type,data,link_id,asset_id,valid_from,valid_to) VALUES ('A','text','{}',NULL,NULL,'t0',NULL)", [])?;
            c.execute("INSERT INTO slide_elements (slide_id,element_id,z_order,valid_from,valid_to) VALUES ('s1','A',0,'t0',NULL)", [])?;
        }
        Ok(())
    }).unwrap();
    let a = ElementWrite { id: "A".into(), el_type: "text".into(), data: "{}".into(), link_id: None, asset_id: None };
    db_write_slide("s1".into(), vec![a]).unwrap();
    with_db(|c| {
        let rows: i64 = c.query_row("SELECT COUNT(*) FROM elements WHERE id='A' AND valid_to IS NULL", [], |r| r.get(0))?;
        let js: i64 = c.query_row("SELECT COUNT(*) FROM slide_elements WHERE element_id='A' AND valid_to IS NULL", [], |r| r.get(0))?;
        assert_eq!((rows, js), (1, 1));
        Ok(())
    }).unwrap();
}

#[test]
fn test_set_slides_upserts_and_closes_missing_slides_with_their_junctions() {
    setup_test_db();
    let s = |id: &str, pos: i32| SlideWrite { id: id.into(), position: pos, notes: String::new(), group_id: None, config: String::new() };
    db_set_slides(vec![s("s1", 0), s("s2", 1)]).unwrap();
    let a = ElementWrite { id: "A".into(), el_type: "text".into(), data: "{}".into(), link_id: None, asset_id: None };
    db_write_slide("s2".into(), vec![a]).unwrap();
    db_set_slides(vec![s("s1", 0), s("s2", 1)]).unwrap(); // no change, no new versions
    db_set_slides(vec![s("s1", 0)]).unwrap();             // s2 deleted
    with_db(|c| {
        let versions: i64 = c.query_row("SELECT COUNT(*) FROM slides WHERE id='s1'", [], |r| r.get(0))?;
        assert_eq!(versions, 1);
        let live_s2: i64 = c.query_row("SELECT COUNT(*) FROM slides WHERE id='s2' AND valid_to IS NULL", [], |r| r.get(0))?;
        let live_j: i64 = c.query_row("SELECT COUNT(*) FROM slide_elements WHERE slide_id='s2' AND valid_to IS NULL", [], |r| r.get(0))?;
        assert_eq!((live_s2, live_j), (0, 0));
        Ok(())
    }).unwrap();
}

#[test]
fn test_loader_ignores_junctions_on_deleted_slides() {
    setup_test_db();
    let s = |id: &str, pos: i32| SlideWrite { id: id.into(), position: pos, notes: String::new(), group_id: None, config: String::new() };
    db_set_slides(vec![s("s1", 0), s("s2", 1)]).unwrap();
    let a = ElementWrite { id: "A".into(), el_type: "text".into(), data: "{}".into(), link_id: None, asset_id: None };
    db_write_slide("s1".into(), vec![a]).unwrap();
    // a stray live junction on a CLOSED slide (the #199 shape)
    with_db(|c| {
        c.execute("UPDATE slides SET valid_to='t9' WHERE id='s2'", [])?;
        c.execute("INSERT INTO slide_elements (slide_id,element_id,z_order,valid_from,valid_to) VALUES ('s2','A',0,'t9',NULL)", [])?;
        Ok(())
    }).unwrap();
    let v: serde_json::Value = serde_json::from_str(&db_load_presentation().unwrap()).unwrap();
    assert!(v["slides"][0]["elements"][0].get("syncId").is_none(), "A is on one live slide only");
}
```

If `setup_test_db` is not the module's helper name, use the existing helper the other `db_*` tests in `mod tests` call to open a fresh in-memory DB.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src-tauri && cargo test --lib -- --test-threads=1 write_slide set_slides loader_ignores`
Expected: compile errors (`db_write_slide`, `db_set_slides`, `ElementWrite`, `SlideWrite` not found).

- [ ] **Step 3: Implement the commands** (in `storage.rs`, after `db_update_z_order`):

```rust
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementWrite {
    pub id: String,
    #[serde(rename = "type")]
    pub el_type: String,
    pub data: String,
    pub link_id: Option<String>,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideWrite {
    pub id: String,
    pub position: i32,
    pub notes: String,
    pub group_id: Option<String>,
    /// JSON string of per-slide overrides, or "" for none (stored as NULL).
    pub config: String,
}

/// Write one slide's elements whole: upsert each element's row by id (a new
/// version only when it differs, or when duplicate current rows exist), then make
/// the slide's live junctions exactly `elements`, in that order. Idempotent. An
/// element no longer on the slide keeps its row (like any deleted element).
#[tauri::command]
pub fn db_write_slide(slide_id: String, elements: Vec<ElementWrite>) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for el in &elements {
        if !seen.insert(el.id.as_str()) {
            return Err(format!("element {} appears twice on slide {}", el.id, slide_id));
        }
    }
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        for el in &elements {
            let live: i64 = tx.query_row(
                "SELECT COUNT(*) FROM elements WHERE id = ?1 AND valid_to IS NULL",
                params![&el.id], |r| r.get(0))?;
            let same = live == 1 && tx.query_row(
                "SELECT type = ?2 AND data = ?3 AND link_id IS ?4 AND asset_id IS ?5 \
                 FROM elements WHERE id = ?1 AND valid_to IS NULL",
                params![&el.id, &el.el_type, &el.data, &el.link_id, &el.asset_id],
                |r| r.get::<_, bool>(0))?;
            if !same {
                tx.execute("UPDATE elements SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL",
                    params![&ts, &el.id])?;
                tx.execute(
                    "INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                    params![&el.id, &el.el_type, &el.data, &el.link_id, &el.asset_id, &ts])?;
            }
        }
        // Current junctions: element_id -> all live z_orders (more than one = a duplicate).
        let mut current: std::collections::HashMap<String, Vec<i32>> = std::collections::HashMap::new();
        {
            let mut stmt = tx.prepare(
                "SELECT element_id, z_order FROM slide_elements WHERE slide_id = ?1 AND valid_to IS NULL")?;
            let rows = stmt.query_map(params![&slide_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?)))?;
            for row in rows { let (id, z) = row?; current.entry(id).or_default().push(z); }
        }
        let desired: std::collections::HashMap<&str, i32> =
            elements.iter().enumerate().map(|(z, e)| (e.id.as_str(), z as i32)).collect();
        for (id, zs) in &current {
            let keep = desired.get(id.as_str()).is_some_and(|z| zs.as_slice() == [*z]);
            if !keep {
                tx.execute("UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND element_id = ?3 AND valid_to IS NULL",
                    params![&ts, &slide_id, id])?;
            }
        }
        for (z, el) in elements.iter().enumerate() {
            let kept = current.get(&el.id).is_some_and(|zs| zs.as_slice() == [z as i32]);
            if !kept {
                tx.execute("INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) \
                            VALUES (?1, ?2, ?3, ?4, NULL)", params![&slide_id, &el.id, z as i32, &ts])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Write the slide list whole: upsert each slide's row (a new version only when it
/// differs), and close every live slide not in `slides`, with its junctions.
#[tauri::command]
pub fn db_set_slides(slides: Vec<SlideWrite>) -> Result<(), String> {
    let ts = timestamp();
    with_db(|conn| {
        let tx = conn.unchecked_transaction()?;
        let keep: std::collections::HashSet<&str> = slides.iter().map(|s| s.id.as_str()).collect();
        let live: Vec<String> = tx.prepare("SELECT id FROM slides WHERE valid_to IS NULL")?
            .query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        for id in live.iter().filter(|id| !keep.contains(id.as_str())) {
            tx.execute("UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, id])?;
            tx.execute("UPDATE slide_elements SET valid_to = ?1 WHERE slide_id = ?2 AND valid_to IS NULL", params![&ts, id])?;
        }
        for s in &slides {
            let config: Option<&str> = if s.config.is_empty() { None } else { Some(s.config.as_str()) };
            let n: i64 = tx.query_row("SELECT COUNT(*) FROM slides WHERE id = ?1 AND valid_to IS NULL",
                params![&s.id], |r| r.get(0))?;
            let same = n == 1 && tx.query_row(
                "SELECT position = ?2 AND notes IS ?3 AND group_id IS ?4 AND config IS ?5 \
                 FROM slides WHERE id = ?1 AND valid_to IS NULL",
                params![&s.id, s.position, &s.notes, &s.group_id, &config], |r| r.get::<_, bool>(0))?;
            if !same {
                tx.execute("UPDATE slides SET valid_to = ?1 WHERE id = ?2 AND valid_to IS NULL", params![&ts, &s.id])?;
                tx.execute("INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) \
                            VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                    params![&s.id, s.position, &s.notes, &s.group_id, &config, &ts])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}
```

Register both in `lib.rs` next to `storage::db_update_z_order,`:

```rust
            storage::db_write_slide,
            storage::db_set_slides,
```

- [ ] **Step 4: Loader fix (#199).** In `db_load_presentation`'s junction query (~1054) only count junctions on live slides:

```rust
        let mut stmt = conn.prepare(
            "SELECT se.slide_id, se.element_id, se.z_order FROM slide_elements se \
             JOIN slides s ON s.id = se.slide_id AND s.valid_to IS NULL \
             WHERE se.valid_to IS NULL ORDER BY se.slide_id, se.z_order, se.element_id",
        )?;
```

- [ ] **Step 5: Run the Rust gates**

Run: `cargo test --lib -- --test-threads=1` then `cargo clippy -- -D warnings` and `cargo check`.
Expected: all pass, including the four new tests.

- [ ] **Step 6: Mirror both commands and the loader query in the harness's fake backend** (`src/store/syncHunt.test.ts`, the `switch` that has `case 'db_update_slide'`; same SQL as above, in the fake's style with `this.ts()` and `this.tx(...)`):

```ts
      case 'db_write_slide': {
        const ts = this.ts();
        const els = a.elements as { id: string; type: string; data: string; linkId: string | null; assetId: string | null }[];
        const seen = new Set<string>();
        for (const e of els) { if (seen.has(e.id)) throw new Error(`element ${e.id} appears twice on slide ${a.slideId}`); seen.add(e.id); }
        this.tx(() => {
          for (const e of els) {
            const live = (c().prepare('SELECT COUNT(*) AS n FROM elements WHERE id = ? AND valid_to IS NULL').get(e.id) as Row).n as number;
            const same = live === 1 && !!(c().prepare('SELECT (type = ? AND data = ? AND link_id IS ? AND asset_id IS ?) AS s FROM elements WHERE id = ? AND valid_to IS NULL')
              .get(e.type, e.data, e.linkId ?? null, e.assetId ?? null, e.id) as Row).s;
            if (!same) {
              c().prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, e.id);
              c().prepare('INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
                .run(e.id, e.type, e.data, e.linkId ?? null, e.assetId ?? null, ts);
            }
          }
          const current = new Map<string, number[]>();
          for (const r of c().prepare('SELECT element_id, z_order FROM slide_elements WHERE slide_id = ? AND valid_to IS NULL').all(a.slideId as string) as Row[]) {
            const k = r.element_id as string; current.set(k, [...(current.get(k) ?? []), r.z_order as number]);
          }
          const desired = new Map(els.map((e, z) => [e.id, z]));
          for (const [id, zs] of current) {
            const z = desired.get(id);
            if (!(z !== undefined && zs.length === 1 && zs[0] === z))
              c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL').run(ts, a.slideId as string, id);
          }
          els.forEach((e, z) => {
            const zs = current.get(e.id);
            if (!(zs && zs.length === 1 && zs[0] === z))
              c().prepare('INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES (?, ?, ?, ?, NULL)').run(a.slideId as string, e.id, z, ts);
          });
        });
        return undefined;
      }
      case 'db_set_slides': {
        const ts = this.ts();
        const ss = a.slides as { id: string; position: number; notes: string; groupId: string | null; config: string }[];
        this.tx(() => {
          const keep = new Set(ss.map((s) => s.id));
          for (const r of c().prepare('SELECT id FROM slides WHERE valid_to IS NULL').all() as Row[]) {
            if (keep.has(r.id as string)) continue;
            c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, r.id as string);
            c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND valid_to IS NULL').run(ts, r.id as string);
          }
          for (const s of ss) {
            const cfg = s.config === '' ? null : s.config;
            const n = (c().prepare('SELECT COUNT(*) AS n FROM slides WHERE id = ? AND valid_to IS NULL').get(s.id) as Row).n as number;
            const same = n === 1 && !!(c().prepare('SELECT (position = ? AND notes IS ? AND group_id IS ? AND config IS ?) AS s FROM slides WHERE id = ? AND valid_to IS NULL')
              .get(s.position, s.notes, s.groupId ?? null, cfg, s.id) as Row).s;
            if (!same) {
              c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, s.id);
              c().prepare('INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
                .run(s.id, s.position, s.notes, s.groupId ?? null, cfg, ts);
            }
          }
        });
        return undefined;
      }
```

Also change the fake loader's junction query (in its `db_load_presentation` case) to the same live-slide join as Step 4.

- [ ] **Step 7: Run the unit suite** — nothing calls the new commands yet, so the result must be unchanged.

Run: `npx tsc --noEmit && npx vitest run`
Expected: same 36 failures in `syncHunt.test.ts` (no new ones), everything else passes.

- [ ] **Step 8: Commit** — `feat(storage): whole-slide write commands and live-slide sync derivation (#199)`.

---

### Task 2: One id per element, derived `syncId`, and the whole-slide save

These land together: each alone breaks the others (fresh duplicate ids under the new save become separate rows; shared ids under the old save insert duplicate rows).

**Files:**
- Modify: `src/lib/syncLink.ts` (add `deriveSyncIds`; `IDENTITY_KEYS`)
- Modify: `src/store/presentation.ts` (store `set` wrapper; `duplicateSlide`, `addBuildSlide`, `updateElement`, `moveElementsBy`, `freeElement`, `resyncElement`, `promoteToSync`; the write-through section ~1143-1520 and the subscriber ~1767-1899)
- Modify: `src/lib/pasteClip.ts` (join reuses the source id)
- Test: `src/lib/syncLink.test.ts`, `src/store/presentation.test.ts`, `src/store/presentation.exercise.test.ts`, `src/store/syncHunt.test.ts`

**Interfaces:**
- Consumes: `db_write_slide`, `db_set_slides` from Task 1.
- Produces: `deriveSyncIds(slides: Slide[]): Slide[]` (returns the same array when nothing changes, and the same slide objects for unchanged slides). After this task every element's `syncId` equals its `id` exactly when that id appears on more than one slide, and is absent otherwise.

- [ ] **Step 1: Failing unit test for `deriveSyncIds`** (in `src/lib/syncLink.test.ts`):

```ts
import { deriveSyncIds } from './syncLink';
describe('deriveSyncIds', () => {
  const s = (id: string, ids: string[], syncs: (string | undefined)[] = []) =>
    ({ id, layout: 'default', notes: '', elements: ids.map((e, i) => ({ id: e, type: 'text', preset: 'body', html: e, position: { x: 0, y: 0, width: 1, height: 1 }, ...(syncs[i] ? { syncId: syncs[i] } : {}) })) }) as any;
  it('marks an id synced exactly when it is on more than one slide', () => {
    const out = deriveSyncIds([s('a', ['X', 'Y']), s('b', ['X'])]);
    expect(out[0].elements.map((e: any) => e.syncId)).toEqual(['X', undefined]);
    expect(out[1].elements[0].syncId).toBe('X');
  });
  it('clears a stale syncId and keeps untouched slides/arrays identical', () => {
    const slides = [s('a', ['X'], ['OLD']), s('b', ['Z'])];
    const out = deriveSyncIds(slides);
    expect(out[0].elements[0].syncId).toBeUndefined();
    expect(out[1]).toBe(slides[1]);
    const again = deriveSyncIds(out);
    expect(again).toBe(out);
  });
});
```

Run: `npx vitest run src/lib/syncLink.test.ts -t deriveSyncIds` — Expected: FAIL (not exported).

- [ ] **Step 2: Implement `deriveSyncIds` and trim `IDENTITY_KEYS`** (in `src/lib/syncLink.ts`):

```ts
/** Rule 3 (docs/sync-and-link.md addendum): an element is synced exactly when its
 *  id appears on more than one slide. Sets syncId = id for those, clears it for
 *  the rest. Returns the SAME array/slide/element objects when nothing changes. */
export function deriveSyncIds(slides: Slide[]): Slide[] {
  const count = new Map<string, number>();
  for (const s of slides) for (const el of s.elements) count.set(el.id, (count.get(el.id) ?? 0) + 1);
  let changed = false;
  const next = slides.map((s) => {
    let slideChanged = false;
    const elements = s.elements.map((el) => {
      const want = (count.get(el.id) ?? 0) > 1 ? el.id : undefined;
      if (el.syncId === want) return el;
      slideChanged = true;
      const copy = { ...el } as SlideElement;
      if (want) copy.syncId = want; else delete copy.syncId;
      return copy;
    });
    if (!slideChanged) return s;
    changed = true;
    return { ...s, elements };
  });
  return changed ? next : slides;
}
```

and change `IDENTITY_KEYS` to `['id', 'syncId'] as const` with the comment: "Copies of one element are the same element (one row): only its id and the derived syncId are not data. linkId and the remembered ids belong to the element and propagate to every copy." Run the test: PASS.

- [ ] **Step 3: Wrap the store's `set` so every change derives `syncId`** (in `presentation.ts` at `temporal((set, get) => ({`):

```ts
  temporal(
    (rawSet, get) => {
      // Rule 3: syncId is derived after EVERY change, in one place. Undo/redo
      // restore snapshots taken through this set, so they are already derived.
      const derive = (part: any) => {
        if (!part || !part.presentation) return part;
        const slides = deriveSyncIds(part.presentation.slides);
        return slides === part.presentation.slides ? part : { ...part, presentation: { ...part.presentation, slides } };
      };
      const set: typeof rawSet = ((partial: any, replace?: any) =>
        rawSet(typeof partial === 'function' ? (st: any) => derive(partial(st)) : derive(partial), replace)) as typeof rawSet;
      return ({
```

and close the extra `return ({ ... })` / `}` at the end of the store object. Import `deriveSyncIds` from `../lib/syncLink`.

- [ ] **Step 4: Duplicate and build keep ids** — in `duplicateSlide` (~297) and `addBuildSlide` (~447), stop setting `syncId` by hand and stop minting element ids:

```ts
          // One id per element (docs/sync-and-link.md addendum): the copy shows the
          // SAME elements, so it keeps their ids; syncId is derived. The row gets a
          // dormant linkId that a later free reuses to animate.
          const updatedOriginalElements = original.elements.map((el) => ({
            ...el, linkId: el.linkId || crypto.randomUUID(), _syncId: undefined, _linkId: undefined,
          }));
          slides[index] = { ...original, elements: updatedOriginalElements };
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(slides[index])),
            id: crypto.randomUUID(),
          };
```

(`addBuildSlide` the same, keeping its existing `groupId` handling and not touching `_syncId`/`_linkId`, as today.)

- [ ] **Step 5: Edits and moves propagate by id.** Replace `updateElement`'s body after `const updatedElement = ...` with a single map: every instance with that id becomes `updatedElement` (copies are the same element), and slides with no match are returned unchanged:

```ts
          const updatedElement = { ...element, ...changes } as SlideElement;
          // Copies of one element are the same element (one row), so the change
          // applies wherever this id appears. Slides without it are untouched.
          const slides = state.presentation.slides.map((slide) =>
            slide.elements.some((el) => el.id === elementId)
              ? { ...slide, elements: slide.elements.map((el) => (el.id === elementId ? updatedElement : el)) }
              : slide);
          return { presentation: { ...state.presentation, slides }, isDirty: true };
```

In `moveElementsBy`, replace the `syncIds` collection and its branch with: move every element whose id is in `elementIds`, on every slide (same id = same element), leaving other slides unchanged; drop the separate `updateCurrentSlide` branch.

- [ ] **Step 6: Free, resync and promote under one id.**

`freeElement` — freed copy gets a new id and remembers the row it left; the remaining copies (same old id) carry the shared link; slides without the element are untouched:

```ts
        const rowId = el.id;
        const newId = crypto.randomUUID();
        const sharedLinkId = el.linkId || crypto.randomUUID();
        void runFreeHook(el, newId);
        set((state) => ({
          presentation: {
            ...state.presentation,
            slides: state.presentation.slides.map((slide, idx) => {
              if (!slide.elements.some((e) => e.id === rowId)) return slide;
              return { ...slide, elements: slide.elements.map((e) => {
                if (e.id !== rowId) return e;
                if (idx === csi) return { ...e, id: newId, _syncId: rowId, linkId: sharedLinkId } as SlideElement;
                return e.linkId === sharedLinkId ? e : ({ ...e, linkId: sharedLinkId } as SlideElement);
              }) };
            }),
          },
          // selectedObject remap: unchanged from today (elementId -> newId)
```

`resyncElement` — the instance becomes the row in `_syncId` again (David's 2026-06 decision: same element, its current data), only when that row is on another slide and not already on this one:

```ts
      resyncElement: (elementId) => {
        const st = get();
        const csi = st.currentSlideIndex;
        const el = st.presentation.slides[csi]?.elements.find((e) => e.id === elementId);
        if (!el || !el._syncId) return;
        const rowId = el._syncId;
        if (st.presentation.slides[csi].elements.some((e) => e.id === rowId)) return;
        const peer = st.presentation.slides.flatMap((s, i) => (i === csi ? [] : s.elements)).find((e) => e.id === rowId);
        if (!peer) return; // nothing to rejoin (badge is hidden in this case too)
        void runResyncHook(el);
        set((state) => ({
          presentation: {
            ...state.presentation,
            slides: state.presentation.slides.map((slide, idx) => (idx !== csi ? slide : {
              ...slide, elements: slide.elements.map((e) => (e.id === elementId ? peer : e)),
            })),
          },
          selectedObject: remapSelection(state.selectedObject, elementId, rowId),
          isDirty: true,
        }));
        flushSyncLinkNow();
      },
```

Add next to `shiftArrow` and use it in free (`elementId -> newId`) and resync:

```ts
function remapSelection(sel: SelectedObject, from: string, to: string): SelectedObject {
  if (!sel) return sel;
  if (sel.type === 'element' && sel.id === from) return { type: 'element', id: to };
  if (sel.type === 'multi' && sel.ids.includes(from)) return { type: 'multi', ids: sel.ids.map((i) => (i === from ? to : i)) };
  return sel;
}
```

`promoteToSync` — every link partner on another slide becomes the master element itself (same id), except on a slide that already shows the master (it can't appear twice); slides without partners are untouched; drop the hand-set `syncId`:

```ts
            slides: state.presentation.slides.map((slide) => {
              if (slide.elements.some((el) => el.id === masterId)) return slide;
              let done = false;
              const elements = slide.elements.map((el) => {
                if (done || el.linkId !== linkId) return el;
                done = true;
                return { ...master } as SlideElement;
              });
              return done ? { ...slide, elements } : slide;
            }),
```

- [ ] **Step 7: A joining paste reuses the source id** (`src/lib/pasteClip.ts`, in the element loop): when `pasteElementDelta` says the paste joins (cross-slide, source synced), the new element is `{ ...currentInstanceOf(el.id) }` with the SAME id instead of `crypto.randomUUID()`; if no instance with that id exists in the deck now, fall back to today's link-to-source path. (Task 3 refines the full rule.)

- [ ] **Step 8: Replace the write-through save.** In `presentation.ts`, replace the dirty sets and structural maps (~1157-1198, keeping `presentationRows`), `hasPendingSqliteChanges`, `flushSqliteBatch` (~1212-1479) and the subscriber (~1767-1899) with:

```ts
// Dirty tracking. A slide is dirty when its element list changed (different
// element objects or order); the slide list is dirty when slides were added,
// removed, reordered or their metadata changed. Writes are whole-slide and
// idempotent (db_write_slide / db_set_slides), so nothing is inferred.
const dirtySlideIds = new Set<string>();
let dirtySlideList = false;
let dirtyPresentation = false;

function hasPendingSqliteChanges(): boolean {
  return dirtyPresentation || dirtySlideList || dirtySlideIds.size > 0;
}

/** The row data for one element: promoted columns out, remembered ids kept (#198). */
function elementWrite(el: SlideElement) {
  const { linkId, syncId, assetId, src, demoSrc, ...data } = el as any;
  void syncId; void src; void demoSrc;
  return { id: el.id, type: el.type, data: JSON.stringify(data), linkId: linkId || null, assetId: assetId || null };
}

async function flushSqliteBatch(): Promise<boolean> {
  if (!sqliteDbPath) return true;
  await flushAllOverlays();
  const batchPres = dirtyPresentation; dirtyPresentation = false;
  const batchList = dirtySlideList; dirtySlideList = false;
  const batchSlides = new Set(dirtySlideIds); dirtySlideIds.clear();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const state = usePresentationStore.getState();
    if (batchPres) {
      for (const [key, value] of Object.entries(presentationRows(state.presentation))) {
        await invoke('db_update_presentation', { key, value });
      }
    }
    if (batchList || batchSlides.size > 0) {
      await invoke('db_set_slides', {
        slides: state.presentation.slides.map((s, position) => {
          const m = slideMeta(s);
          return { id: s.id, position, notes: m.notes, groupId: m.groupId || null,
            config: Object.keys(m.config).length === 0 ? '' : JSON.stringify(m.config) };
        }),
      });
    }
    for (const slide of state.presentation.slides) {
      if (!batchSlides.has(slide.id)) continue;
      await invoke('db_write_slide', { slideId: slide.id, elements: slide.elements.map(elementWrite) });
    }
    return true;
  } catch (e) {
    dirtyPresentation ||= batchPres;
    dirtySlideList ||= batchList;
    for (const id of batchSlides) dirtySlideIds.add(id);
    console.error('SQLite flush failed:', e);
    return false;
  }
}
```

`flushSyncLinkNow` also checkpoints (#200):

```ts
function flushSyncLinkNow(): void {
  void flushToSqlite().then(async () => {
    try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('db_checkpoint'); } catch { /* ignore */ }
  });
}
```

Subscriber:

```ts
usePresentationStore.subscribe((state) => {
  if (!sqliteDbPath) return;
  const curr = state.presentation;
  if (curr === prevPresentation) return;
  if (!prevPresentation) { prevPresentation = curr; return; }
  const prev = prevPresentation;
  prevPresentation = curr;
  let any = false;
  if (JSON.stringify(presentationRows(prev)) !== JSON.stringify(presentationRows(curr))) { dirtyPresentation = true; any = true; }
  const prevById = new Map(prev.slides.map((s) => [s.id, s]));
  if (prev.slides.length !== curr.slides.length || prev.slides.some((s, i) => s.id !== curr.slides[i].id)) {
    dirtySlideList = true; any = true;
  }
  for (const cs of curr.slides) {
    const ps = prevById.get(cs.id);
    if (!ps) { dirtySlideIds.add(cs.id); dirtySlideList = true; any = true; continue; }
    if (ps === cs) continue;
    if (JSON.stringify(slideMeta(ps)) !== JSON.stringify(slideMeta(cs))) { dirtySlideList = true; any = true; }
    if (ps.elements !== cs.elements && (ps.elements.length !== cs.elements.length
        || cs.elements.some((el, j) => el !== ps.elements[j]))) {
      dirtySlideIds.add(cs.id); any = true;
    }
  }
  if (any) scheduleFlush();
});
```

Delete `markElementDirty`, `markSlideDirty`, `markPresentationDirty` and the `jkey`/structural maps. Remove the now-unused `db_add_element`, `db_add_element_to_slide`, `db_remove_element_from_slide`, `db_update_element`, `db_update_slide`, `db_update_z_order`, `db_add_slide`, `db_delete_slide`, `db_element_exists` *callers* only (keep the Rust commands; the CLI and tests use some).

- [ ] **Step 9: Review Focus tests** (in `src/store/presentation.exercise.test.ts`, using its existing invoke-capture setup):
  1. Big deck: build 50 slides, one element duplicated onto 3 of them, flush, clear captured calls, `updateElement` it, flush → exactly 3 `db_write_slide` calls, for those 3 slides.
  2. #177: element on slide 0, `selectSlide(1)`, `updateElement(id, { html: 'late' })` → slide 0's element has `html === 'late'`.
  3. Notebook overlay keys: duplicate a slide holding a notebook, free the copy → the freed copy's `syncId ?? id` is its new id and the original's key is unchanged.

- [ ] **Step 10: Existing tests whose expectations change** — run `npx vitest run`, and for each failure outside `syncHunt.test.ts` decide: (a) it asserted the old id shape (duplicate mints fresh ids; resync mints a fresh id; `markElementDirty`; specific `db_add_element`/`db_update_z_order` calls) → update it to the new shape and record it in the commit body; (b) anything else → it's a bug in this task, fix the code. Known (a) cases: the resync test "mints a fresh instance id (mirror of free)" in `presentation.test.ts` (now: the instance takes the `_syncId` row's id); the `markElementDirty` race test (~presentation.test.ts:134; rewrite against `flushToSqlite` with two edits around an in-flight flush).

- [ ] **Step 11: Run the harness**

Run: `npx vitest run src/store/syncHunt.test.ts`
Expected: the #194, #195, #198 and #199 scenarios pass; the 8 guards pass. Remaining failures may only be #196 (paste/link rules, Task 3), #197 if any, and #201 (Task 5) — record which.

- [ ] **Step 12: Gates and commit** — `npx tsc --noEmit && npx vitest run` (only the expected remaining harness failures), then commit `fix(sync): one id per element, derived syncId, whole-slide save (#194 #195 #198 #200)` with the changed-test list in the body.

---

### Task 3: Paste and link rules (#196)

**Files:**
- Modify: `src/lib/clipboardModel.ts` (`EigendeckClip.fromDeck?: string`)
- Modify: `src/App.tsx` (`handleCopy` sets `fromDeck: getDeckToken()`)
- Modify: `src/lib/syncLink.ts` (`pasteDecision`), `src/lib/pasteClip.ts`, `src/store/presentation.ts` (`linkElements`)
- Test: `src/lib/syncLink.test.ts`, `src/lib/pasteClip.test.ts` (or the existing paste tests file), `src/store/presentation.test.ts`

**Interfaces:**
- Produces: `pasteDecision(sourceId: string, targetSlideIndex: number, slides: Slide[], sameDeck: boolean, sameSlide: boolean): 'join' | 'link' | 'independent'`.

- [ ] **Step 1: Failing tests for `pasteDecision`:**

```ts
describe('pasteDecision', () => {
  const sl = (id: string, ids: string[]) => ({ id, layout: 'default', notes: '', elements: ids.map((e) => ({ id: e, type: 'text' })) }) as any;
  const deck = [sl('a', ['X']), sl('b', ['X', 'Y']), sl('c', [])];
  it('joins when the source is synced now and absent from the target', () => expect(pasteDecision('X', 2, deck, true, false)).toBe('join'));
  it('links when the source exists but is not synced', () => expect(pasteDecision('Y', 2, deck, true, false)).toBe('link'));
  it('is independent when the target already shows the element', () => expect(pasteDecision('X', 1, deck, true, false)).toBe('independent'));
  it('is independent when the source is gone', () => expect(pasteDecision('Z', 2, deck, true, false)).toBe('independent'));
  it('is independent from another deck even if the id exists', () => expect(pasteDecision('X', 2, deck, false, false)).toBe('independent'));
  it('is independent on the same slide', () => expect(pasteDecision('X', 0, deck, true, true)).toBe('independent'));
});
```

- [ ] **Step 2: Implement** (`syncLink.ts`):

```ts
/** How a pasted copy of element `sourceId` lands (docs/sync-and-link.md join table;
 *  copy-and-paste.md resolves references at PASTE time, "if it still exists"). */
export function pasteDecision(
  sourceId: string, targetSlideIndex: number, slides: Slide[], sameDeck: boolean, sameSlide: boolean,
): 'join' | 'link' | 'independent' {
  if (sameSlide || !sameDeck) return 'independent';
  if (slides[targetSlideIndex]?.elements.some((e) => e.id === sourceId)) return 'independent';
  const onSlides = slides.filter((s) => s.elements.some((e) => e.id === sourceId)).length;
  if (onSlides > 1) return 'join';
  if (onSlides === 1) return 'link';
  return 'independent';
}
```

- [ ] **Step 3: Use it in `pasteInternalClip`** — `sameDeck = !clip.fromDeck || clip.fromDeck === getDeckToken()`; `join` → push `{ ...currentInstance }` (same id, the element's current data — P1); `link` → today's fresh id + `linkPastedToSource`; `independent` → fresh id, `detachDelta()`, offset only when same slide. Remove `pasteElementDelta` and its tests (record in commit body). Add `fromDeck: getDeckToken()` to both clip objects in `App.tsx` `handleCopy`.

- [ ] **Step 4: Link rule (R1).** In `linkElements`, after computing `{ delta, mergeIds }`, refuse when the merged group would have two members on one slide:

```ts
        const groupIds = new Set([...mergeIds, source.linkId, target.linkId].filter(Boolean) as string[]);
        const perSlide = st.presentation.slides.map((s, idx) => new Set(s.elements
          .filter((el) => (idx === csi && el.id === sourceId) || (idx === targetSlideIndex && el.id === targetId)
            || (el.linkId != null && groupIds.has(el.linkId)))
          .map((el) => el.id)).size);
        if (perSlide.some((n) => n > 1)) return; // a link group has at most one element per slide
```

Test in `presentation.test.ts`: link N (slide 0) to Q (slide 1) where slide 0 already holds P in Q's group → no change.

- [ ] **Step 5: Run** `npx vitest run src/store/syncHunt.test.ts` → the #196 scenarios (A1 is Task 4) pass. Gates, commit `fix(sync): paste and link rules under one id per element (#196)`.

---

### Task 4: Badges, Unlink on synced elements, and removing `pruneOrphanedGroups`

**Files:**
- Modify: `src/lib/syncLink.ts` (`canResync`, `canRelink`, `hasLinkPartner`; delete `pruneOrphanedGroups`)
- Modify: `src/components/SlideElementRenderer.tsx` (~1338-1345 context menu; ~1593-1660 badges)
- Modify: `src/components/PropertiesPanel.tsx` (~241 Unlink All; ~904 Unlink)
- Modify: `src/store/presentation.ts` (`deleteSlide`, `deleteElement`, `deleteElements`, `unlinkElement`)
- Test: `src/lib/syncLink.test.ts`, `src/store/presentation.test.ts`

**Interfaces:**
- Produces: `canResync(slides, slideIndex, el): boolean`, `canRelink(slides, slideIndex, el): boolean`, `hasLinkPartner(slides, slideIndex, el): boolean`.

- [ ] **Step 1: Failing tests** for the three helpers (grey S only while the `_syncId` row is on another slide and not on this one; grey A only while another slide carries `_linkId`; live A only with a partner of a different id) and for `unlinkElement` being a no-op on a synced element.

- [ ] **Step 2: Implement:**

```ts
export function canResync(slides: Slide[], slideIndex: number, el: Pick<SlideElement, '_syncId'>): boolean {
  const row = el._syncId; if (!row) return false;
  if (slides[slideIndex]?.elements.some((e) => e.id === row)) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.id === row));
}
export function canRelink(slides: Slide[], slideIndex: number, el: Pick<SlideElement, '_linkId'>): boolean {
  const l = el._linkId; if (!l) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.linkId === l));
}
export function hasLinkPartner(slides: Slide[], slideIndex: number, el: Pick<SlideElement, 'id' | 'linkId'>): boolean {
  const l = el.linkId; if (!l) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.linkId === l && e.id !== el.id));
}
```

`unlinkElement`: return early when `el.syncId` (Unlink is only for unsynced elements). Remove the `pruneOrphanedGroups(...)` calls from `deleteSlide`, `deleteElement`, `deleteElements` (use the filtered slides directly) and delete the function and its tests (record in commit body).

- [ ] **Step 3: UI.** Context menu: show "Unlink Animation" only when `linkId && !syncId`. Badges: S green when `syncId` (free); grey when `_syncId && canResync(...)` (resync); grey promote when `!syncId && !_syncId && hasLinkPartner(...)`. A badge: hidden when `syncId`; purple when `linkId && hasLinkPartner(...)`; grey when `!linkId && _linkId && canRelink(...)`. PropertiesPanel: hide the Unlink button when the selected element is synced; "Unlink All" skips synced elements.

- [ ] **Step 4: Run the harness** → A1/A2 pass. Gates, commit `fix(sync): computed badges, no Unlink on synced elements, drop pruneOrphanedGroups (#196)`.

---

### Task 5: Undo clamps the slide index (#201)

**Files:** Modify `src/store/presentation.ts` (`followUndoChange`); Test `src/store/presentation.test.ts`.

- [ ] **Step 1: Failing test:** select the last slide, `duplicateSlide(last)`, `undoWithNav()` → `currentSlideIndex < slides.length`.
- [ ] **Step 2: Implement** at the top of `followUndoChange`:

```ts
  if (st.currentSlideIndex > after.length - 1) {
    st.selectSlide(Math.max(0, after.length - 1));
    return;
  }
```

- [ ] **Step 3:** harness IDX passes; gates; commit `fix(undo): keep the slide index in range after undo (#201)`.

---

### Task 6: Docs and session log

**Files:** `docs/sync-and-link.md`, `docs/SQLITE_STORAGE.md`, `docs/DESIGN_DECISIONS.md` ("Write-through subscriber"), `docs/SPEC.md` ("Incremental write-through"), `docs/copy-and-paste.md` (paste resolution, deck token), `.claude/logs/2026-10-06-sqlite-source-of-truth-session.md`.

- [ ] **Step 1:** In `sync-and-link.md`, mark the addendum implemented; rewrite "Canonical id and in-session instances" (session ids are row ids; no alias writes), the `IDENTITY_KEYS` section (`['id','syncId']`), the store API table and pure-helper table (free, resync, unlink-only-unsynced, `pasteDecision`, `canResync`/`canRelink`/`hasLinkPartner`; `pruneOrphanedGroups` and `pasteElementDelta` removed), and the paste row of the join table.
- [ ] **Step 2:** `SQLITE_STORAGE.md`: document `db_write_slide`, `db_set_slides`, and the live-slide rule in the loader. `DESIGN_DECISIONS.md` / `SPEC.md`: the subscriber marks dirty slides and the slide list; writes are whole-slide and idempotent; still only dirty items, still one version per edit.
- [ ] **Step 3:** Session log (prose): what changed and why, and the test results. Commit `docs(sync): document the SQLite-is-the-source-of-truth model as implemented`.

---

### Task 7: Full verification

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run` → 0 failures (all 36 former failures pass; guards pass).
- [ ] **Step 2:** Rust gates; fmt drift unchanged (452 lines baseline).
- [ ] **Step 3:** Rebuild: `VITE_EIGENDECK_SEAM=1 npm run build`; `cargo build --bin eigendeck --bin eigendeck-cli` into `$HOME/el-target`.
- [ ] **Step 4:** Full e2e: `E2E_APP=$HOME/el-target/debug/eigendeck E2E_CLI=$HOME/el-target/debug/eigendeck-cli bash e2e/run-all.sh` → `ALL E2E PASS`, including the 23 sync entries on their first attempt.
- [ ] **Step 5:** Post the results on #194–#201 and close the ones whose tests now pass (keep #190, #191 open). Do not push or merge without David's go-ahead.
