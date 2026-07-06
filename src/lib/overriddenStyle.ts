import type { CSSProperties } from 'react';

// UI MOTIF — a control that is OVERRIDDEN by a higher-priority setting or state
// (global watching off, global demo-internet off, per-deck block, untrusted deck,
// unapproved file, …) renders GREYED + STRUCK-THROUGH on its label and DIMMED on
// its container, with a short reason nearby. Shared so "this control is real but
// currently has no effect, and here's why" reads identically across every panel.
// See docs/USER-FACING-MESSAGES.md → "Overridden by a higher-priority setting".
//
// Reserve it for the "no effect right now" case — NOT for a control the user
// simply left off themselves (that's its own state, shown plainly).

export const OVERRIDDEN_DIM = 0.55;
export const overriddenLabel: CSSProperties = { textDecoration: 'line-through', color: '#9ca3af' };
