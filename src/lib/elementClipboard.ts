// Asset-aware copy/paste for slide elements (image / SVG), layered on the Rust
// `clip_*` commands (see src-tauri/src/clip.rs).
//
// Copy of an image element: the bytes go to a process-global "internal clip"
// (shared across windows) AND to the system clipboard (so it pastes into other
// apps). Paste prefers the internal clip — it stores the bytes into the CURRENT
// deck and rebuilds the element with a fresh id/assetId (so cross-deck paste
// works and never carries a stale syncId). The internal clip is staleness-
// checked in Rust (clipboard generation), so a foreign copy after an eigendeck
// copy correctly wins.

import { invoke } from '@tauri-apps/api/core';
import type { SlideElement, TextElement, Slide, PresentationConfig } from '../types/presentation';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import { resolveTheme, themeColorForPreset } from './themes';
import { fontForPreset, fontFamilyForPreset } from './fonts';
import { renderMathInHtml, containsMath } from './mathjaxRenderer';
import { markAsEigendeck } from './clipboard';

const PAYLOAD_V = 1;

interface AssetClipPayload {
  v: number;
  sourceDeckId: string | null;
  /** The element's renderable fields, minus identity (id/assetId/sync/link). */
  element: Record<string, unknown>;
  ext: string;
}

interface AssetMeta { mime_type?: string; path?: string }
interface PeekResult { payload: string; mime: string; has_bytes: boolean }

/** True for elements we copy as a real image/SVG asset. */
export function isCopyableAsset(el: SlideElement): boolean {
  return el.type === 'image' && !!(el as { assetId?: string }).assetId;
}

function detachedFields(el: SlideElement): Record<string, unknown> {
  const rest = { ...(el as unknown as Record<string, unknown>) };
  for (const k of ['id', 'assetId', 'syncId', '_syncId', 'linkId', '_linkId']) delete rest[k];
  return rest;
}

function extFromMime(mime: string, path?: string): string {
  if (path && path.includes('.')) return path.split('.').pop()!.toLowerCase();
  switch (mime) {
    case 'image/svg+xml': return 'svg';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

/** Copy a single image/SVG element to the internal clip + system clipboard.
 *  Returns true if it handled the element. */
export async function copyAssetElement(el: SlideElement): Promise<boolean> {
  if (!isCopyableAsset(el)) return false;
  const assetId = (el as { assetId: string }).assetId;
  try {
    const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_id', { assetId });
    const kind = (el as { kind?: string }).kind;
    const mime = meta?.mime_type || (kind === 'svg' ? 'image/svg+xml' : 'image/png');
    let sourceDeckId: string | null = null;
    try { sourceDeckId = await invoke<string>('db_get_project_id'); } catch { /* unsaved deck */ }
    const payload: AssetClipPayload = {
      v: PAYLOAD_V, sourceDeckId, element: detachedFields(el), ext: extFromMime(mime, meta?.path),
    };
    await invoke('clip_copy_asset', { assetId, payload: JSON.stringify(payload), mime });
    return true;
  } catch (e) {
    console.warn('[clip] copyAssetElement failed:', e);
    return false;
  }
}

/** Clear the internal clip — call when copying something that is NOT an asset
 *  element, so a later paste doesn't resurrect a stale image. */
export async function clearInternalClip(): Promise<void> {
  try { await invoke('clip_clear_internal'); } catch { /* ignore */ }
}

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Copy a TEXT element to the system clipboard as rich text/html (formatting
 *  preserved, math rendered to inline SVG) + a plain-text fallback, so it pastes
 *  into other apps (Docs / Word / Slides / mail). The HTML carries the eigendeck
 *  marker so pasting back into eigendeck takes the in-app element path instead of
 *  the rich-HTML→image route. */
export async function copyTextElementHtml(
  el: TextElement, slide: Slide, config: PresentationConfig, theme: string,
): Promise<boolean> {
  try {
    const preset = TEXT_PRESET_STYLES[el.preset];
    const pkg = fontForPreset(el.preset, slide, config);
    const fontFamily = el.fontFamily || fontFamilyForPreset(pkg, el.preset);
    const fontSize = effectiveFontSize(el, config);
    const color = el.color || themeColorForPreset(resolveTheme(theme, slide.theme), el.preset);
    const rendered = containsMath(el.html)
      ? await renderMathInHtml(el.html, pkg.id, config.mathPreamble)
      : (el.html || '');
    const styled =
      `<div style="font-family:${fontFamily};font-size:${fontSize}px;font-weight:${preset.fontWeight};` +
      `font-style:${preset.fontStyle};color:${color};line-height:1.3;">${rendered}</div>`;
    await invoke('clip_write_html', { html: markAsEigendeck(styled), plain: plainTextFromHtml(el.html || '') });
    return true;
  } catch (e) {
    console.warn('[clip] copyTextElementHtml failed:', e);
    return false;
  }
}

/** Is there a FRESH internal asset clip right now? (staleness-checked in Rust).
 *  The image-paste handler uses this to defer to the internal-clip paste. */
export async function hasFreshInternalAsset(): Promise<boolean> {
  try {
    const m = await invoke<PeekResult | null>('clip_peek_internal');
    return !!(m && m.has_bytes);
  } catch { return false; }
}

/** Paste the internal clip's asset into the CURRENT deck and return a new,
 *  detached element (fresh id + assetId). Null if there's no fresh internal
 *  clip. The caller adds it to the slide. */
export async function pasteAssetElement(): Promise<SlideElement | null> {
  let meta: PeekResult | null = null;
  try { meta = await invoke<PeekResult | null>('clip_peek_internal'); } catch { return null; }
  if (!meta || !meta.has_bytes) return null;
  let payload: AssetClipPayload;
  try { payload = JSON.parse(meta.payload) as AssetClipPayload; } catch { return null; }
  const ext = payload.ext || 'png';
  const path = `images/pasted-${Date.now()}.${ext}`;
  let res: { asset_id: string; payload: string } | null = null;
  try { res = await invoke<{ asset_id: string; payload: string } | null>('clip_paste_asset', { path }); }
  catch (e) { console.warn('[clip] clip_paste_asset failed:', e); return null; }
  if (!res) return null;
  return {
    ...payload.element,
    id: crypto.randomUUID(),
    assetId: res.asset_id,
  } as unknown as SlideElement;
}
