interface TextEl {
  preset: string;
  position: { x: number; y: number; width: number; height: number };
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: { top: number; right: number; bottom: number; left: number };
  borderRadius?: number;
  rotation?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  boxTint?: string;
  boxShadow?: boolean;
  textEffect?: 'shadow' | 'glow';
}

export function textElementHtml(
  el: TextEl,
  o: {
    color: string;
    fontFamily: string;
    fontSize: number;
    content: string;
    len: (px: number) => string;
    fsize: (px: number) => string;
    /** Resolved slide ThemeColors — enables the boxTint themed fill. */
    theme?: { background?: string; accent?: string };
  },
): string;
