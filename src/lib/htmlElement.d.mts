export const HTML_SANDBOX_LOCKED: string;
export const HTML_SANDBOX_EDITABLE: string;
export const HTML_ELEMENT_CSP: string;

export function htmlElementSrcdoc(
  rawHtml: string | undefined | null,
  background?: string,
  vars?: Record<string, string | number>,
  theme?: { background?: string; accent?: string },
  opts?: { raw?: boolean },
): string;

export function htmlElementIframeHtml(
  el: { html?: string; background?: string; vars?: Record<string, string | number> },
  styleStr: string,
  sandbox?: string,
  theme?: { background?: string; accent?: string },
): string;

export function htmlElementScaledIframeHtml(
  el: { html?: string; background?: string; vars?: Record<string, string | number> },
  boxStyleStr: string,
  L: { designW: number; designH: number; scale: number; offsetX: number; offsetY: number },
  unit?: string,
  sandbox?: string,
  theme?: { background?: string; accent?: string },
): string;

export function htmlIsScaled(
  el: { scaleMode?: boolean; scaleW?: number; scaleH?: number } | null | undefined,
): boolean;

export function htmlScaleLayout(
  bw: number, bh: number, sw: number, sh: number,
): { designW: number; designH: number; scale: number; offsetX: number; offsetY: number };
