// Startup / welcome screen (issue #66). Shown when no project is open, so every
// editing session is anchored to a file on disk from the start — which makes
// file-watching, linked assets, relative paths, and saves work uniformly (no
// in-memory untitled special case). Launching with a file arg skips this.
import { useEffect, useState } from 'react';
import { createProject, createScratchProject, openProject, openRecentProject, getRecentProjects, type RecentProject } from '../store/fileOps';

type FileMeta = { mtime: number | null; missing: boolean };

export function WelcomeWindow() {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [meta, setMeta] = useState<Record<string, FileMeta>>({});

  useEffect(() => {
    const list = getRecentProjects();
    setRecents(list);
    // Stat each recent file for its true last-edit time (mtime) and to detect
    // ones that have been moved/deleted.
    (async () => {
      try {
        const { stat } = await import('@tauri-apps/plugin-fs');
        const out: Record<string, FileMeta> = {};
        await Promise.all(list.map(async (r) => {
          try {
            const st = await stat(r.path);
            out[r.path] = { mtime: st.mtime ? new Date(st.mtime).getTime() : null, missing: false };
          } catch {
            out[r.path] = { mtime: null, missing: true };
          }
        }));
        setMeta(out);
      } catch { /* not in Tauri */ }
    })();
  }, []);

  const fileName = (p: string) => p.split(/[\\/]/).pop() || p;
  const baseName = (p: string) => p.replace(/\.eigendeck$/i, '').split(/[\\/]/).pop() || p;
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]+$/, '');
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="welcome-root">
      <div className="welcome-card">
        <div className="welcome-title">Eigendeck</div>
        <div className="welcome-subtitle">Open or create a presentation to begin.</div>

        <div className="welcome-actions">
          <button className="welcome-btn primary" onClick={() => void createProject()}>
            <span className="welcome-btn-main">New Presentation…</span>
            <span className="welcome-btn-sub">Choose where to save it</span>
          </button>
          <button className="welcome-btn" onClick={() => void openProject()}>
            <span className="welcome-btn-main">Open…</span>
            <span className="welcome-btn-sub">Browse for an .eigendeck file</span>
          </button>
        </div>

        <button className="welcome-scratch" onClick={() => void createScratchProject()}
          title="Create a disk-anchored scratch deck without choosing a path (Save As later to give it a home)">
          or start a scratch deck →
        </button>

        <div className="welcome-recent-head">Recent</div>
        {recents.length === 0 ? (
          <div className="welcome-recent-empty">No recent presentations yet.</div>
        ) : (
          <ul className="welcome-recent-list">
            {recents.map((r) => {
              const m = meta[r.path];
              const date = m?.missing ? 'missing' : (m?.mtime != null ? fmtDate(m.mtime) : '');
              return (
                <li key={r.path}>
                  <button className="welcome-recent-item" onClick={() => void openRecentProject(r.path)} title={r.path}>
                    <span className="welcome-recent-row">
                      <span className="welcome-recent-name">{r.title?.trim() || baseName(r.path)}</span>
                      <span className={`welcome-recent-date${m?.missing ? ' missing' : ''}`}>{date}</span>
                    </span>
                    <span className="welcome-recent-file">{fileName(r.path)}</span>
                    <span className="welcome-recent-path">{dirOf(r.path)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
