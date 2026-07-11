# Security mitigation brainstorm — 2026-07-01

Basis for a design, NOT a design. Each file below is one category of mitigation
ideas (options, some mutually exclusive) to pick from when a design is written.

Context: security audit (`/work/.claude/notes/security-audit-2026-07-01.md`) found
that opening a shared `.eigendeck` can reach Tauri IPC → arbitrary file R/W. The
three root vulnerabilities distilled with the user:

1. **TAURI-access** — injected HTML can reach Tauri internals (→ file access).
2. **DEMO-iframes** — demos are not isolated from the parent.
3. **PATH-access** — watched/linked files can target arbitrary paths.

Plus the cross-cutting levers: sanitization, blast-radius containment,
provenance/trust, and exfiltration/egress.

## Categories
- [A — Stop injected code from reaching Tauri](A-tauri-access.md)
- [B — Injection sinks (HTML/SVG sanitization)](B-injection-sinks.md)
- [C — Demo iframe isolation](C-demo-iframe-isolation.md)
- [D — File-path access](D-file-path-access.md)
- [E — Blast-radius containment (capabilities)](E-blast-radius-containment.md)
- [F — Provenance / trust (local vs remote)](F-provenance-trust.md)
- [G — Exfiltration / egress](G-exfiltration-egress.md)

Related open issues: #112 (notebook reload), #113 (math-aware \textcolor).
