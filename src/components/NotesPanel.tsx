import { useState } from 'react';
import { usePresentationStore } from '../store/presentation';

export function NotesPanel() {
  const { presentation, currentSlideIndex, updateSlide } =
    usePresentationStore();
  const [collapsed, setCollapsed] = useState(false);

  const slide = presentation.slides[currentSlideIndex];
  if (!slide) return null;

  return (
    <div className={`notes-panel ${collapsed ? 'collapsed' : ''}`}>
      <div
        className="notes-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="notes-toggle">{collapsed ? '▸' : '▾'}</span>
        <span>Speaker Notes</span>
      </div>
      {!collapsed && (
        <textarea
          className="notes-textarea"
          value={slide.notes}
          onChange={(e) => updateSlide(currentSlideIndex, { notes: e.target.value })}
          placeholder="Add speaker notes for this slide..."
        />
      )}
    </div>
  );
}
