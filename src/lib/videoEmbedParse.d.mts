export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo' | 'peertube';
  id: string;
  origin?: string;
}
export function detectVideoProvider(raw: string): ParsedEmbed | null;
