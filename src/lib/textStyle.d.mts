export function textBackgroundCss(el: { backgroundColor?: string; backgroundOpacity?: number }): string | undefined;
export function textEffectCss(effect: 'shadow' | 'glow' | undefined, color: string): string | undefined;
export function textShadowCss(el: { textEffect?: 'shadow' | 'glow' }, color: string): string | undefined;
export function textBoxShadowCss(el: { boxShadow?: boolean; backgroundColor?: string }): string | undefined;
