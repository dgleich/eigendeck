# G. Exfiltration / egress (the "how does it leave" lever)

Reading/executing is only harmful if data can leave. Controlling egress is an
independent backstop: even if an injection or a path-read succeeds, block the exit.

- Global **CSP `connect-src`** restricting where anything (app or demo) can phone
  home — the primary network-egress control.
- Per-demo network allowlist (default deny) for demos that legitimately fetch.
- **Warn** when a deck triggers a read outside its dir, or a demo attempts network
  egress.
- Treat the deck's own **save/sync as an egress channel**: a secret read into an
  embedded asset leaks if the deck is re-shared or sits in a synced folder → the
  embedded-snapshot-default + not auto-reading untrusted `external_path` (D) prevents
  secrets landing in the deck in the first place.
- Optionally flag/redact assets whose source was outside the deck dir before
  save/export; size/anomaly checks before embedding external bytes.
