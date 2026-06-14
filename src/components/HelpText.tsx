// Explanatory help text under inspector controls — the grey paragraphs that
// explain what a toggle does. Gated on the global `showHelpText` preference
// (on by default) so experienced users can turn them off for a denser panel.
import type { ReactNode, CSSProperties } from 'react';
import { usePreference } from '../lib/preferences';

export function HelpText({ children, style, inline }: {
  children: ReactNode; style?: CSSProperties; inline?: boolean;
}) {
  const [show] = usePreference('showHelpText');
  if (!show) return null;
  if (inline) {
    return <span style={{ fontSize: 11, color: '#8a9099', ...style }}>{children}</span>;
  }
  return (
    <div style={{ fontSize: 11, color: '#8a9099', marginTop: 3, lineHeight: 1.4, ...style }}>
      {children}
    </div>
  );
}
