export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo' | 'peertube';
  id: string;
  origin?: string;
}
export const DEMO_SANDBOX: string;
export const VIDEO_EMBED_ALLOW: string;
export function detectVideoProvider(raw: string): ParsedEmbed | null;

export interface EmbedOpts {
  provider?: string; url?: string;
  loop?: boolean; autoplay?: boolean; muted?: boolean; controls?: boolean; captions?: boolean;
}
export function buildEmbedSrc(el: EmbedOpts, opts?: { jsApi?: boolean }): string | null;
