# F. Provenance / trust (local vs remote)

You can't trust anything *inside* the deck to say whether it's local or received —
that's attacker-forgeable. Trust must come from state the attacker can't write.
Detection improves UX; the embedded-snapshot default (D) provides the actual safety.

- **App-side trust ledger** in app-data, keyed by a random **deck-id token** stamped
  at create/save (survives moves; a received deck's token isn't in your ledger).
- **Session provenance** — created/saved this session → trusted (covers "building my
  own deck now").
- **OS mark-of-the-web** (`com.apple.quarantine` on macOS, `Zone.Identifier` on
  Windows) as a "received" corroborator — can add suspicion, never grant trust.
- Trust is per **(deck, set-of-linked-paths)** — re-consent when the link set changes
  (defeats "edit a returned deck to add malicious paths").
- Path tiering even for trusted decks: deck-dir = low risk; sensitive dirs = warn.
