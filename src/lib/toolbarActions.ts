// Route a native-toolbar action id (from the macOS NSToolbar, delivered as a
// Rust→JS `toolbar:action` event) to the matching app action — the SAME action
// the HTML toolbar button runs, so the two toolbars never drift. Pure (takes its
// handlers), so the mapping is unit-testable without Tauri.

export interface ToolbarHandlers {
  addSlide: () => void;
  addBuild: () => void;
  present: () => void;
  save: () => void;
  export: () => void;
}

/** Returns true if the id was handled. */
export function dispatchToolbarAction(id: string, h: ToolbarHandlers): boolean {
  switch (id) {
    case 'add-slide': h.addSlide(); return true;
    case 'add-build': h.addBuild(); return true;
    case 'present': h.present(); return true;
    case 'save': h.save(); return true;
    case 'export': h.export(); return true;
    default: return false;
  }
}
