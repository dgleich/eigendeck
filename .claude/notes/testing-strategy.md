# Testing strategy for eigendeck

Captured 2026-05-27 after a session where two related bugs in
AssetSection required two different test approaches to catch.

## The two bug classes

### Math bugs
Output of a pure function doesn't match expected. Caught by direct
function calls in unit tests.

Example: `computeAssetUsage(presentation, assetId, path)` returned
`{ elementCount: 2, slideCount: 2 }` when 2 copies on 1 slide should
have been `slideCount: 1`. Pure function; deterministic; one call
per test case.

### Render-loop / lifecycle bugs
The function math is fine, but how a React component subscribes to
state or schedules effects causes a runtime defect — infinite re-
renders, missing cleanup, stale closure, leak. NOT caught by pure
function tests; component never gets rendered.

Example: a Zustand selector returning `{ a, b }` (object literal)
caused Object.is equality to always fail → re-render → selector runs
→ new object → ∞. App crashed on Inspector open. Fix was to split
into two primitive-returning selectors.

## The two test types

### Pure-logic test (preferred when applicable)
`src/lib/<name>.test.ts`. Imports the helper, calls it directly,
asserts the output. Fast, no async, no mocking.

Pattern: extract testable logic into a pure function in `src/lib/`,
then test the function. The React component just calls the helper.

Example: `src/lib/assetUsage.test.ts` covers `computeAssetUsage`.
The component (`AssetSection.tsx`) imports it via
`computeAssetUsage(s.presentation, assetId, path)` inside a
selector — minimal logic in the component itself.

When to use:
- Math, formatting, parsing, transformations
- Data shape conversions
- Predicates (is this element bound to this asset?)
- Anything that takes data in and returns data out

### Mount test (when the component is the unit)
`src/components/<name>.test.tsx`. Mounts the component in jsdom
with mocked Tauri + a fixture Zustand store. Asserts rendered
output and that the mount itself succeeded (didn't time out, didn't
throw "Maximum update depth exceeded", didn't leak).

Example: `src/components/AssetSection.test.tsx`. Six scenarios; the
load-bearing one is "mount on a shared-asset deck without infinite
loop" — uses `waitFor` with a 2-second timeout to assert the
caption renders. An infinite-loop regression makes React throw
before the timeout, the test fails.

When to use:
- Render-loop / re-subscription / cleanup bugs that pure-logic
  tests can't see
- "Component handles this prop combination gracefully"
- Conditional rendering (different states show different UI)
- Anything that requires the component lifecycle to surface

## Setup that's already in place

- **Vitest + jsdom** configured in `vite.config.ts` (`test.environment: "jsdom"`)
- **@testing-library/react** + jest-dom matchers in `package.json`
- **Tauri mocks** in `src/test/setup.ts`: `invoke`, plugin-dialog,
  plugin-fs all stubbed. Tests can `vi.mocked(invoke).mockImplementation(...)`
  per test.
- Zustand store can be configured per test via `usePresentationStore.setState({...})`

## Patterns to follow

### Extracting for testability
If a component has non-trivial logic in a useMemo, selector, or
effect, **extract it to a `src/lib/` helper** and write a pure-
logic test for the helper. The component is then thin (just calls
the helper); mount tests can focus on rendering correctness.

Done in this session: `src/lib/assetUsage.ts` extracted from three
near-duplicate copies in `AssetSection.tsx` and `assetInsert.ts`.

### Mocking Tauri commands
```ts
import { invoke } from '@tauri-apps/api/core';
import { vi } from 'vitest';

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => mockedInvoke.mockReset());

mockedInvoke.mockImplementation(async (cmd: string) => {
  switch (cmd) {
    case 'db_get_asset_meta_by_id': return { /* fake meta */ };
    default: return null;
  }
});
```

### Setting Zustand state for tests
```ts
usePresentationStore.setState({
  projectPath: '/path/to/test',
  presentation: fixtureDeck,
});
```

### Async fetch + waitFor pattern
Components that fetch from Tauri on mount: use `waitFor` to wait
for the rendered output that depends on the fetch. Default
timeout (1s) is usually fine; bump to 2s if there's a chain of
async updates.

```ts
await waitFor(() => {
  expect(screen.getByText(/expected/i)).toBeInTheDocument();
}, { timeout: 2000 });
```

This pattern doubles as the infinite-loop guard — React throws
before waitFor returns if the component is mis-rendering.

### Test-helper gotcha
When writing a test helper that takes overrides and applies
defaults, use `'key' in obj` instead of `obj.key ?? default` so
that an explicit `null` in the caller's override actually reaches
the result. `??` would replace `null` with the default and make
"property: null" cases untestable.

Bit me once during this session — caught it inside the test setup
itself when one mount test failed unexpectedly.

## File layout convention

```
src/
├── lib/
│   ├── assetUsage.ts          ← pure helper
│   ├── assetUsage.test.ts     ← pure-logic test (next to source)
│   └── ...
├── components/
│   ├── AssetSection.tsx
│   ├── AssetSection.test.tsx  ← mount test (next to source)
│   └── ...
├── __tests__/                 ← cross-cutting / legacy tests
│   ├── print-export.test.ts
│   ├── fonts.test.ts
│   └── ...
├── store/
│   └── presentation.test.ts   ← store-action tests (next to source)
└── test/
    └── setup.ts               ← Vitest setup: Tauri mocks
```

Per-source-file colocation (`Foo.tsx` ↔ `Foo.test.tsx`) for new
tests. The `__tests__/` directory holds older / cross-cutting
tests.

## What test type to write for new code

| Scenario | Test type |
|---|---|
| New pure function in `lib/` | Pure-logic test next to source |
| Bug fix in pure logic | Pure-logic test that reproduces the bug |
| New component | Mount test for the rendering shape; pure-logic tests for any extracted helpers |
| Component-level bug (infinite loop, missing cleanup, conditional render glitch) | Mount test that reproduces |
| New Tauri command | Rust unit test in `src-tauri/src/storage.rs` mod tests + (if non-trivial wire format) a JS test stub |
| Schema change | Rust test in storage.rs; PER_PROJECT_TABLES test + sqlite_master cross-check for wipe paths |

## When NOT to test

Trivial passthroughs, one-line wrappers, deprecation shims. Adds
maintenance cost without catching anything. Use judgment.

## What this session shipped

- `src/lib/assetUsage.test.ts` — 13 pure-logic tests (the math)
- `src/components/AssetSection.test.tsx` — 6 mount tests (the
  rendering shape, with the infinite-loop guard as the load-
  bearing one)

145 / 145 total tests pass on the branch as of this writing.
