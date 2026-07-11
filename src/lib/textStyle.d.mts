export function textBackgroundCss(el: { backgroundColor?: string; backgroundOpacity?: number }): string | undefined;
export const TINT_STRENGTH: number;
export function mixHex(a: string, b: string, t: number): string;
export function textBackgroundResolved(el: { backgroundColor?: string; backgroundOpacity?: number; boxTint?: string } | null | undefined, theme?: { background?: string; accent?: string }): string | undefined;
export function resolveColor(color: string | undefined, theme: { accent?: string } | null | undefined, fallback: string): string;
export function textEffectCss(effect: 'shadow' | 'glow' | undefined, color: string): string | undefined;
export function textShadowCss(el: { textEffect?: 'shadow' | 'glow' }, color: string): string | undefined;
export function textBoxShadowCss(el: { boxShadow?: boolean; backgroundColor?: string; boxTint?: string }): string | undefined;
export function applyCodeFont(html: string, mono: string | undefined): string;
