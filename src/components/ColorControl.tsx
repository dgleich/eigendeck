// The ONE color picker, shared by the inline text-format toolbar and the inspector
// (text color / background / arrow / cover). Purely presentational: it renders the
// swatch row consistently and emits SEMANTIC events — onNone / onColor(hex) /
// onTint(base). Each call site wires those to its exact field writes (or the
// toolbar's execCommand), so the data model stays per-site while the UI is unified.
//
// Row order (all wrapping): [None chip] [deck palette] [tint swatches] [fixed
// palette] [custom-hex]. A tint's swatch previews its RESOLVED look against the
// current theme; a corner mark flags it as "themed" (adapts per theme) vs a fixed
// color. Only render the pieces a site opts into.
import type { CSSProperties } from 'react';
import type { Swatch } from '../lib/colorPalettes';
import { TINT_SWATCHES, ACCENT_TINT } from '../lib/colorPalettes';
import { textBackgroundResolved } from '../lib/textStyle.mjs';
import type { ThemeColors } from '../lib/themes';

// The 135° corner triangle that marks a swatch as a themed tint.
const TINT_MARK = 'linear-gradient(135deg, transparent 60%, rgba(0,0,0,0.4) 60%)';

export interface ColorControlProps {
  /** Current literal color (hex), for fixed/custom active state. `undefined` = none. */
  value?: string;
  /** Current tint base (`el.boxTint`, or `'accent'` when a foreground uses the token),
   *  for tint active state. */
  activeTint?: string;
  /** Fixed swatches. */
  palette: readonly Swatch[];
  /** Deck brand colors (rendered first, ringed). */
  customPalette?: readonly string[];
  allowNone?: boolean;
  /** Label for the clear chip — 'Auto' | 'None' | 'Match'. */
  noneLabel?: string;
  allowCustom?: boolean;
  /** Enables the tint swatches. `fill` = the full wash palette (text bg / cover);
   *  `accent` = just the theme-accent solid (foreground text / arrow). */
  tint?: { kind: 'fill' | 'accent'; theme: ThemeColors };
  onNone?: () => void;
  onColor: (hex: string) => void;
  onTint?: (base: string) => void;
}

const SWATCH = 'prop-color-swatch';
const CUSTOM_STYLE: CSSProperties = { width: 24, height: 24, padding: 0, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' };

/** Preview color for a tint base against the current theme. */
function tintPreview(base: string, kind: 'fill' | 'accent', theme: ThemeColors): string {
  if (kind === 'accent') return theme.accent;
  return textBackgroundResolved({ boxTint: base }, theme) || theme.background;
}

export function ColorControl({
  value, activeTint, palette, customPalette, allowNone, noneLabel = 'None',
  allowCustom, tint, onNone, onColor, onTint,
}: ColorControlProps) {
  const tintSwatches = tint ? (tint.kind === 'accent' ? ACCENT_TINT : TINT_SWATCHES) : [];
  return (
    <div className="prop-color-row">
      {allowNone && (
        <button
          className={`prop-zbtn ${!value && !activeTint ? 'active' : ''}`}
          style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
          onClick={onNone}
        >
          {noneLabel}
        </button>
      )}
      {(customPalette ?? []).map((c) => (
        <button
          key={`cp-${c}`}
          className={`${SWATCH} ${value === c && !activeTint ? 'active' : ''}`}
          style={{ background: c, boxShadow: '0 0 0 1px #94a3b8 inset' }}
          title={`Deck palette ${c}`}
          onClick={() => onColor(c)}
        />
      ))}
      {tintSwatches.map(({ base, title }) => (
        <button
          key={`tint-${base}`}
          className={`${SWATCH} ${activeTint === base ? 'active' : ''}`}
          title={title}
          style={{ background: tintPreview(base, tint!.kind, tint!.theme), backgroundImage: TINT_MARK }}
          onClick={() => onTint?.(base)}
        />
      ))}
      {palette.map(({ color, label }) => (
        <button
          key={color}
          className={`${SWATCH} ${value === color && !activeTint ? 'active' : ''}`}
          title={label}
          style={{ background: color, border: color === '#ffffff' ? '1px solid #ccc' : undefined }}
          onClick={() => onColor(color)}
        />
      ))}
      {allowCustom && (
        <input
          type="color"
          title="Custom colour"
          value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onColor(e.target.value)}
          style={CUSTOM_STYLE}
        />
      )}
    </div>
  );
}
