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
import { TEXT_PRESET_STYLES, effectiveFontSize, resolveColor } from '../types/presentation';
import { resolveTheme, themeColorForPreset } from './themes';
import { fontForPreset, fontFamilyForPreset } from './fonts';
import { renderMathInHtmlSync, containsMath } from './mathjaxRenderer';

const PAYLOAD_V = 1;

interface AssetClipPayload {
  v: number;
  sourceDeckId: string | null;
  /** The element's renderable fields, minus identity (id/assetId/sync/link). */
  element: Record<string, unknown>;
  ext: string;
  // Cross-slide LINK re-resolution on paste. The image path bypasses the
  // text/html private flavor (arboard's image write clobbers it), so the link
  // metadata rides in this payload instead. See docs/copy-and-paste.md.
  fromSlideId?: string;
  fromSlideIndex?: number;
  sourceId?: string;
  sourceSyncId?: string;
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
    case 'application/pdf': return 'pdf';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

/** Copy a single image/SVG element to the internal clip + system clipboard.
 *  Returns true if it handled the element. */
export async function copyAssetElement(
  el: SlideElement,
  ctx?: { fromSlideId: string; fromSlideIndex: number },
): Promise<boolean> {
  if (!isCopyableAsset(el)) return false;
  const assetId = (el as { assetId: string }).assetId;
  try {
    const meta = await invoke<AssetMeta | null>('db_get_asset_meta_by_id', { assetId });
    const kind = (el as { kind?: string }).kind;
    // Fall back from kind when asset meta is missing — must distinguish pdf, or
    // build_reps would send it down the raster (PNG) branch instead of the PDF one.
    const mime = meta?.mime_type
      || (kind === 'svg' ? 'image/svg+xml' : kind === 'pdf' ? 'application/pdf' : 'image/png');
    let sourceDeckId: string | null = null;
    try { sourceDeckId = await invoke<string>('db_get_project_id'); } catch { /* unsaved deck */ }
    const payload: AssetClipPayload = {
      v: PAYLOAD_V, sourceDeckId, element: detachedFields(el), ext: extFromMime(mime, meta?.path),
      fromSlideId: ctx?.fromSlideId, fromSlideIndex: ctx?.fromSlideIndex,
      sourceId: el.id, sourceSyncId: (el as { syncId?: string }).syncId,
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

/** The visible (foreign-app-facing) styled HTML + plain text for a copied text
 *  element. Returns the RAW styled markup — the caller wraps it with the marker
 *  + private JSON flavor via encodeClipHtml (clipboardModel). */
export function textElementClipboardHtml(
  el: TextElement, slide: Slide, config: PresentationConfig, theme: string,
): { styledHtml: string; plain: string } {
  const preset = TEXT_PRESET_STYLES[el.preset];
  const pkg = fontForPreset(el.preset, slide, config);
  const fontFamily = el.fontFamily || fontFamilyForPreset(pkg, el.preset);
  const fontSize = effectiveFontSize(el, config);
  const clipTheme = resolveTheme(theme, slide.theme);
  const color = resolveColor(el.color, clipTheme, themeColorForPreset(clipTheme, el.preset));
  const rendered = containsMath(el.html)
    ? (renderMathInHtmlSync(el.html, pkg.id, config.mathPreamble) ?? el.html ?? '')
    : (el.html || '');
  const styled =
    `<div style="font-family:${fontFamily};font-size:${fontSize}px;font-weight:${preset.fontWeight};` +
    `font-style:${preset.fontStyle};color:${color};line-height:1.3;">${rendered}</div>`;
  return { styledHtml: styled, plain: plainTextFromHtml(el.html || '') };
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
export interface PastedAsset {
  element: SlideElement;
  /** Cross-slide link metadata (for the animation link the html private flavor
   *  would otherwise carry). */
  link: { fromSlideId?: string; sourceId?: string; sourceSyncId?: string };
}

export async function pasteAssetElement(): Promise<PastedAsset | null> {
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
  const element = {
    ...payload.element,
    id: crypto.randomUUID(),
    assetId: res.asset_id,
  } as unknown as SlideElement;
  return { element, link: { fromSlideId: payload.fromSlideId, sourceId: payload.sourceId, sourceSyncId: payload.sourceSyncId } };
}
