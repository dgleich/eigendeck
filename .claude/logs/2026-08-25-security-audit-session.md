# Security audit: privileged webview boundary

Audited the first security slice: Tauri commands/capabilities, privileged markup
sinks, iframe messaging, and alternate deck-ingress paths. The central discovery
was that the code's individual containment controls are generally thoughtful, but
two trusted-string assumptions bypass them: a sandboxed demo can forge predictable
MathJax replies, and the SVG text builder interpolates unvalidated deck properties
into markup. Both can feed `dangerouslySetInnerHTML` in the privileged webview;
ambient arbitrary-path custom filesystem commands amplify the impact.

Also found normalization gaps in undo/history and clipboard ingestion, an affected
DOMPurify production dependency, and an unauthenticated presenter navigation
message. Recorded scope, evidence, remediation, verification, and follow-up phases
in `docs/SECURITY-AUDIT-2026-08-25.md`. No application behavior was changed during
this audit pass.
