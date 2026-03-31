import { useState, useRef, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import {
  openProject,
  createProject,
  saveProject,
  exportPresentation,
} from '../store/fileOps';

const THEMES = [
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
  { id: 'league', label: 'League' },
  { id: 'beige', label: 'Beige' },
  { id: 'moon', label: 'Moon' },
  { id: 'solarized', label: 'Solarized' },
  { id: 'night', label: 'Night' },
  { id: 'serif', label: 'Serif' },
  { id: 'simple', label: 'Simple' },
  { id: 'sky', label: 'Sky' },
  { id: 'blood', label: 'Blood' },
];

export function Toolbar() {
  const { presentation, isDirty, setPresenting, setTheme, setTitle, projectPath } =
    usePresentationStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Update window title
  useEffect(() => {
    const dirty = isDirty ? ' *' : '';
    document.title = `${presentation.title}${dirty} — Eigendeck`;
  }, [presentation.title, isDirty]);

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
        <button onClick={createProject} title="New Project">
          New
        </button>
        <button onClick={openProject} title="Open Project">
          Open
        </button>
        <button onClick={handleSave} title="Save (Ctrl+S)">
          Save{isDirty ? ' *' : ''}
        </button>
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
        <select
          className="theme-picker"
          value={presentation.theme}
          onChange={(e) => setTheme(e.target.value)}
          title="Presentation theme"
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button onClick={handleExport} title="Export to HTML">
          Export
        </button>
        <button
          onClick={() => setPresenting(true)}
          title="Present (F5)"
          className="btn-present"
        >
          Present
        </button>
      </div>
    </div>
  );
}
