interface TextEl {
  preset: string;
  position: { x: number; y: number; width: number; height: number };
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: { top: number; right: number; bottom: number; left: number };
  borderRadius?: number;
  rotation?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
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
  },
): string;
