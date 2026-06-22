import type { ThemeColors } from './themes';

export const DEMO_FONTS_STYLE_ID: string;
export const DEMO_VARS_STYLE_ID: string;

export interface DemoThemeFontOpts {
  font?: string;
  narrow?: string;
  mono?: string;
  baseSize?: number;
}

export function demoThemeVarsCss(colors: ThemeColors, opts?: DemoThemeFontOpts): string;
export function demoThemeStyleTag(fontFacesCss: string, varsCss: string): string;
export function injectDemoThemeIntoHtml(html: string, fontFacesCss: string, varsCss: string): string;
export function injectDemoThemeIntoDoc(doc: Document | null, fontFacesCss: string, varsCss: string): void;
