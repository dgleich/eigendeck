export const HTML_SANDBOX_LOCKED: string;
export const HTML_SANDBOX_EDITABLE: string;
export const HTML_ELEMENT_CSP: string;

export function htmlElementSrcdoc(rawHtml: string | undefined | null, background?: string): string;

export function htmlElementIframeHtml(
  el: { html?: string; background?: string },
  styleStr: string,
  sandbox?: string,
): string;
