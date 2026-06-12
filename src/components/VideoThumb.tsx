// Thumbnail for a video element: a file's cached poster frame (previewCache),
// or an embed's provider thumbnail (live oEmbed/CDN URL). Falls back to a ▶ box.

import { useEffect, useState } from 'react';
import type { SlideElement } from '../types/presentation';
import { ElementPreviewImg } from './ElementPreviewImg';
import { fetchEmbedThumbnail } from '../lib/videoEmbed';

const FALLBACK = (
  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 18, color: '#fff', background: '#1f2937' }}>▶</div>
);

export function VideoThumb({ element }: { element: Extract<SlideElement, { type: 'video' }> }) {
  if (element.kind === 'file') {
    return <ElementPreviewImg cacheKey={element.syncId ?? element.id} fallback={FALLBACK} />;
  }
  return <EmbedThumb element={element} />;
}

function EmbedThumb({ element }: { element: Extract<SlideElement, { type: 'video' }> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchEmbedThumbnail(element).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [element.url, element.provider]);
  if (!url) return FALLBACK;
  return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}
