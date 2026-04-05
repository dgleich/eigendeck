import { useState, useRef, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import {
  saveProject,
  exportPresentation,
  getRecentProjects,
  openRecentProject,
} from '../store/fileOps';
import type { RecentProject } from '../store/fileOps';

export function Toolbar() {
  const { presentation, isDirty, setTitle, updateConfig, projectPath } =
    usePresentationStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const recentRef = useRef<HTMLDivElement>(null);

  // Update window title
  useEffect(() => {
    const dirty = isDirty ? ' *' : '';
    document.title = `${presentation.title}${dirty} — Eigendeck`;
  }, [presentation.title, isDirty]);

  // Load recents when dropdown opens
  useEffect(() => {
    if (showRecent) setRecents(getRecentProjects());
  }, [showRecent]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showRecent) return;
    const handleClick = (e: MouseEvent) => {
      if (recentRef.current && !recentRef.current.contains(e.target as Node)) setShowRecent(false);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, [showRecent]);

  const startEditingTitle = () => {
    setTitleDraft(presentation.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const finishEditingTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== presentation.title) {
      setTitle(trimmed);
    }
    setEditingTitle(false);
  };

  const handleSave = async () => {
    try {
      await saveProject();
    } catch (e) {
      console.error('Save failed:', e);
    }
  };

  const handleExport = async () => {
    try {
      await exportPresentation();
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button onClick={() => usePresentationStore.getState().addSlide()} title="Add slide after current">
          + Slide
        </button>
        <button onClick={() => usePresentationStore.getState().addBuildSlide()} title="Duplicate current slide as a build step (same group)">
          + Build
        </button>
        <button onClick={handleSave} title="Save (Cmd+S)">
          Save{isDirty ? ' *' : ''}
        </button>
        <div style={{ position: 'relative' }} ref={recentRef}>
          <button onClick={() => setShowRecent(!showRecent)} title="Recent projects">
            Recent
          </button>
          {showRecent && (
            <div className="recent-dropdown">
              {recents.length === 0 ? (
                <div className="recent-empty">No recent projects</div>
              ) : (
                recents.map((r) => (
                  <button key={r.path} className="recent-item"
                    onClick={() => { openRecentProject(r.path); setShowRecent(false); }}
                    title={r.path}>
                    <span className="recent-title">{r.title}</span>
                    <span className="recent-path">{r.path.split('/').pop()}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div className="toolbar-center">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={finishEditingTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEditingTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="project-title"
            onDoubleClick={startEditingTitle}
            title="Double-click to edit title"
          >
            {presentation.title}
            {projectPath && (
              <span className="project-path" title={projectPath}>
                {' '}
                — {projectPath.split('/').pop()}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="toolbar-right">
        <input
          className="meta-input"
          value={presentation.config.author || ''}
          onChange={(e) => updateConfig({ author: e.target.value })}
          placeholder="Author"
          title="Author name (shown in slide footer)"
        />
        <input
          className="meta-input"
          value={presentation.config.venue || ''}
          onChange={(e) => updateConfig({ venue: e.target.value })}
          placeholder="Venue"
          title="Venue/conference (shown in slide footer)"
        />
        <button onClick={handleExport} title="Export to HTML (Cmd+E)">
          Export
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('start-presenting'))}
          title="Present (F5)"
          className="btn-present"
        >
          Present
        </button>
      </div>
    </div>
  );
}
