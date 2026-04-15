import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore, flushToSqlite } from '../store/presentation';
import type { Presentation } from '../types/presentation';

interface HistoryEntry {
  timestamp: string;
  summary: string;
}

/** Format a timestamp like "2026-04-15T10:30:45.123Z-00000042" for display */
function formatTime(ts: string): string {
  // Strip the sequence suffix
  const iso = ts.replace(/-\d{8}$/, '');
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts.slice(11, 19);
  }
}

function formatDate(ts: string): string {
  const iso = ts.replace(/-\d{8}$/, '');
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return ts.slice(0, 10);
  }
}

export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [previewData, setPreviewData] = useState<Presentation | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const { toggleHistory, setPresentation } = usePresentationStore();

  // Load history entries
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<string>('db_get_history_timestamps').then((json) => {
      if (cancelled) return;
      const parsed: HistoryEntry[] = JSON.parse(json);
      setEntries(parsed);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Load state at selected timestamp
  useEffect(() => {
    if (previewIdx === null) {
      setPreviewData(null);
      return;
    }
    const entry = entries[previewIdx];
    if (!entry) return;
    let cancelled = false;
    invoke<string>('db_get_state_at', { at: entry.timestamp }).then((json) => {
      if (cancelled) return;
      setPreviewData(JSON.parse(json));
      setPreviewSlideIdx(0);
    }).catch((e) => {
      console.error('Failed to load state at', entry.timestamp, e);
    });
    return () => { cancelled = true; };
  }, [previewIdx, entries]);

  // Group entries by date
  const grouped: { date: string; entries: { entry: HistoryEntry; idx: number }[] }[] = [];
  let lastDate = '';
  for (let i = 0; i < entries.length; i++) {
    const date = formatDate(entries[i].timestamp);
    if (date !== lastDate) {
      grouped.push({ date, entries: [] });
      lastDate = date;
    }
    grouped[grouped.length - 1].entries.push({ entry: entries[i], idx: i });
  }

  const previewSlide = previewData?.slides[previewSlideIdx];

  return (
    <div className="history-panel">
      <div className="history-header">
        <span>History</span>
        <button onClick={toggleHistory} title="Close">&times;</button>
      </div>

      {loading && <div className="history-loading">Loading...</div>}

      {!loading && entries.length === 0 && (
        <div className="history-empty">No history yet. Edit your presentation to create history entries.</div>
      )}

      <div className="history-list">
        {grouped.map((group) => (
          <div key={group.date}>
            <div className="history-date">{group.date}</div>
            {group.entries.map(({ entry, idx }) => (
              <button
                key={idx}
                className={`history-entry ${previewIdx === idx ? 'active' : ''}`}
                onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)}
              >
                <span className="history-time">{formatTime(entry.timestamp)}</span>
                <span className="history-summary">{entry.summary}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Preview area */}
      {previewData && previewSlide && (
        <div className="history-preview">
          <div className="history-preview-header">
            <button
              disabled={previewSlideIdx <= 0}
              onClick={() => setPreviewSlideIdx((i) => Math.max(0, i - 1))}
            >&larr;</button>
            <span>Slide {previewSlideIdx + 1} / {previewData.slides.length}</span>
            <button
              disabled={previewSlideIdx >= previewData.slides.length - 1}
              onClick={() => setPreviewSlideIdx((i) => Math.min(previewData.slides.length - 1, i + 1))}
            >&rarr;</button>
          </div>
          <div className="history-preview-canvas" ref={canvasRef}>
            <div className="history-slide-preview" style={{ transform: 'scale(0.18)', transformOrigin: 'top left', width: 1920, height: 1080, background: '#fff', position: 'relative' }}>
              {previewSlide.elements.map((el: any, i: number) => (
                <div
                  key={el.id || i}
                  style={{
                    position: 'absolute',
                    left: el.position?.x ?? 0,
                    top: el.position?.y ?? 0,
                    width: el.position?.width ?? 200,
                    height: el.position?.height ?? 40,
                    fontSize: el.fontSize ?? 24,
                    color: el.color ?? '#222',
                    overflow: 'hidden',
                  }}
                  dangerouslySetInnerHTML={el.html ? { __html: el.html } : undefined}
                >
                  {!el.html && el.type === 'image' && (
                    <div style={{ width: '100%', height: '100%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#9ca3af' }}>img</div>
                  )}
                  {!el.html && el.type === 'demo' && (
                    <div style={{ width: '100%', height: '100%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#3b82f6' }}>demo</div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <button
            className="history-restore-btn"
            onClick={async () => {
              if (previewData && confirm('Restore presentation to this point in time? Current state will be saved first.')) {
                // Flush current state to SQLite so it's preserved in history
                await flushToSqlite();
                setPresentation(previewData);
                toggleHistory();
              }
            }}
          >
            Restore to this point
          </button>
        </div>
      )}
    </div>
  );
}
