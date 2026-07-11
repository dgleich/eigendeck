# D. File-path access (PATH-access)

A crafted deck sets `external_path` to an arbitrary/absolute path; open/reload reads
it. Reading alone doesn't exfiltrate (as a "demo" it just renders the file's text
on the slide) — the real risks are (a) the secret lands in the deck's embedded
bytes → leaks if the deck is re-shared / sits in a synced folder, and (b) it's a
force-multiplier for any surviving egress. So remedies can be lighter than a
perfect path parser.

- **Embedded-snapshot by default**: render the bytes the deck already stores; never
  auto-read `external_path` on open.
- Auto-read/reload only for **trusted** decks (see F); otherwise consent-to-go-live.
- Canonicalize paths; **confine to the deck's own directory**; reject absolute
  paths / `../` escapes for untrusted decks.
- Tier by path: inside deck-dir = low risk; sensitive dirs (`~/.ssh`, keychains,
  browser profiles) = warn/deny even if trusted.
- **Size caps + reject device/special files** (`/dev/*`, fifos) → DoS.
