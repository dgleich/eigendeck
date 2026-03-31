import { usePresentationStore } from '../store/presentation';
import {
  openProject,
  createProject,
  saveProject,
  exportPresentation,
} from '../store/fileOps';

export function Toolbar() {
  const { presentation, isDirty, setPresenting, projectPath } =
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
