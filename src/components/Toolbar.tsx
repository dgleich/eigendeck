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
  const { presentation, isDirty, setPresenting, setTheme, projectPath } =
    usePresentationStore();

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
        <span className="project-title">
          {presentation.title}
          {projectPath && (
            <span className="project-path" title={projectPath}>
              {' '}
              — {projectPath.split('/').pop()}
            </span>
          )}
        </span>
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
