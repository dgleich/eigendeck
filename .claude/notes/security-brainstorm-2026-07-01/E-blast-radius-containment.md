# E. Blast-radius containment (capabilities)

The amplifiers that turn any first-order bug into full-host compromise:
`fs:read-all` + `fs:write-all` to all windows, `assetProtocol.scope: **/*`, `csp: null`.
Fixing these downgrades every remaining injection from "arbitrary code + full disk"
to "inert render bug."

- Replace `fs:read-all` / `fs:write-all` with **narrow scopes** (app-data +
  deck-dir + dialog-granted paths).
- Narrow `assetProtocol.scope` off `**/*` to the same allowed roots.
- Grant the deck's directory subtree at open (runtime scope) so **linked assets
  keep working** — this is the feature-preserving piece.
- **Per-webview capability sets** — the present/projector window shouldn't carry the
  same grants as the main editor.

Feature note: naive fs scoping breaks the linked-asset / auto-reload features; the
deck-dir-grant-at-open is what keeps them alive. Highest feature-impact category.
