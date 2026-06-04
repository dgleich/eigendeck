// Renders an element's cached PNG preview (asset_cache, variant 'preview') as
// an <img>, falling back to `fallback` on a cache miss. Used wherever we show a
// lightweight image stand-in for a live element — the sidebar mini-slide and
// the link picker. Re-reads when the preview is (re)captured.

import { useEffect, useState } from 'react';
import { loadPreviewUrl, onPreviewChange } from '../lib/previewCache';

export function ElementPreviewImg({ cacheKey, fallback, style, className }: {
  /** The element's preview key — its sync identity (syncId ?? id). */
  cacheKey: string;
  fallback: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let owned: string | null = null;
    const load = async () => {
      const u = await loadPreviewUrl(cacheKey);
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      if (owned) URL.revokeObjectURL(owned);
      owned = u;
      setUrl(u);
    };
    void load();
    const off = onPreviewChange(() => { void load(); });
    return () => { cancelled = true; off(); if (owned) URL.revokeObjectURL(owned); };
  }, [cacheKey]);

  if (!url) return <>{fallback}</>;
  return <img src={url} alt="" className={className}
    style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }} />;
}
