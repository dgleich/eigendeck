import { usePresentationStore } from '../store/presentation';
import { TEXT_PRESET_STYLES } from '../types/presentation';
import type { SlideLayout } from '../types/presentation';

const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: 'default', label: 'Default (top-left)' },
  { id: 'centered', label: 'Centered' },
  { id: 'two-column', label: 'Two Column' },
];

const ARROW_COLORS = [
  '#e53e3e', '#dc2626', '#ea580c', '#16a34a',
  '#2563eb', '#9333ea', '#222222', '#6b7280',
];

export function PropertiesPanel() {
  const {
    presentation, currentSlideIndex, selectedObject,
    updateSlide, updateElement, updateConfig, moveElementZ,
  } = usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide) return null;

  const selectedEl = selectedObject?.type === 'element'
    ? slide.elements.find((el) => el.id === selectedObject.id)
    : null;

  return (
    <div className="properties-panel">
      <div className="properties-header">Properties</div>
      <div className="properties-body">
        {(!selectedObject || selectedObject.type === 'slide') && (
          <>
            <PropSection label="Layout">
              <select className="prop-select" value={slide.layout || 'default'}
                onChange={(e) => updateSlide(currentSlideIndex, { layout: e.target.value as SlideLayout })}>
                {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </PropSection>
            <PropSection label="Author">
              <input className="prop-input" value={presentation.config.author || ''}
                onChange={(e) => updateConfig({ author: e.target.value })} />
            </PropSection>
            <PropSection label="Venue">
              <input className="prop-input" value={presentation.config.venue || ''}
                onChange={(e) => updateConfig({ venue: e.target.value })} />
            </PropSection>
          </>
        )}

        {selectedEl && (
          <>
            <PropSection label={`${selectedEl.type} element`}>
              <span style={{ fontSize: 11, color: '#999' }}>{selectedEl.id.slice(0, 8)}</span>
            </PropSection>

            {/* Z-order controls */}
            <PropSection label="Layer">
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'bottom')} title="Move to bottom">⇊</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'down')} title="Move down">↓</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'up')} title="Move up">↑</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'top')} title="Move to top">⇈</button>
              </div>
            </PropSection>

            {/* Position/size for non-arrow elements */}
            {selectedEl.type !== 'arrow' && (
              <PropSection label="Position & Size">
                <div className="prop-grid">
                  <label>X <input className="prop-input-sm" type="number" value={selectedEl.position.x}
                    onChange={(e) => updateElement(selectedEl.id, { position: { ...selectedEl.position, x: parseInt(e.target.value) || 0 } } as any)} /></label>
                  <label>Y <input className="prop-input-sm" type="number" value={selectedEl.position.y}
                    onChange={(e) => updateElement(selectedEl.id, { position: { ...selectedEl.position, y: parseInt(e.target.value) || 0 } } as any)} /></label>
                  <label>W <input className="prop-input-sm" type="number" value={selectedEl.position.width}
                    onChange={(e) => updateElement(selectedEl.id, { position: { ...selectedEl.position, width: parseInt(e.target.value) || 100 } } as any)} /></label>
                  <label>H <input className="prop-input-sm" type="number" value={selectedEl.position.height}
                    onChange={(e) => updateElement(selectedEl.id, { position: { ...selectedEl.position, height: parseInt(e.target.value) || 100 } } as any)} /></label>
                </div>
              </PropSection>
            )}

            {/* Text element properties */}
            {selectedEl.type === 'text' && (
              <>
                <PropSection label="Preset">
                  <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{selectedEl.preset}</span>
                </PropSection>
                <PropSection label="Font Size">
                  <input className="prop-input-sm" type="number"
                    value={selectedEl.fontSize || TEXT_PRESET_STYLES[selectedEl.preset].fontSize}
                    onChange={(e) => updateElement(selectedEl.id, { fontSize: parseInt(e.target.value) || 48 } as any)} />
                </PropSection>
              </>
            )}

            {selectedEl.type === 'arrow' && (
              <>
                <PropSection label="Color">
                  <div className="prop-color-row">
                    {ARROW_COLORS.map((c) => (
                      <button key={c} className={`prop-color-swatch ${selectedEl.color === c ? 'active' : ''}`}
                        style={{ background: c }} onClick={() => updateElement(selectedEl.id, { color: c } as any)} />
                    ))}
                  </div>
                </PropSection>
                <PropSection label="Width">
                  <input className="prop-input-sm" type="number" value={selectedEl.strokeWidth || 4} min={1} max={20}
                    onChange={(e) => updateElement(selectedEl.id, { strokeWidth: parseInt(e.target.value) || 4 } as any)} />
                </PropSection>
                <PropSection label="Head Size">
                  <input className="prop-input-sm" type="number" value={selectedEl.headSize || 16} min={4} max={40}
                    onChange={(e) => updateElement(selectedEl.id, { headSize: parseInt(e.target.value) || 16 } as any)} />
                </PropSection>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PropSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-section">
      <div className="prop-label">{label}</div>
      {children}
    </div>
  );
}
