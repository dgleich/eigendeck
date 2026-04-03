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
    updateSlide, updateElement, updateConfig, moveElementZ, deleteElements,
  } = usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide) return null;

  const selectedEl = selectedObject?.type === 'element'
    ? slide.elements.find((el) => el.id === selectedObject.id)
    : null;

  const multiEls = selectedObject?.type === 'multi'
    ? slide.elements.filter((el) => selectedObject.ids.includes(el.id))
    : [];

  // Alignment helpers for multi-select (non-arrow elements only)
  const alignableEls = multiEls.filter((el) => el.type !== 'arrow');
  const align = (mode: string) => {
    if (alignableEls.length < 2) return;
    const positions = alignableEls.map((el) => el.position);
    switch (mode) {
      case 'left': {
        const minX = Math.min(...positions.map((p) => p.x));
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, x: minX } } as any));
        break;
      }
      case 'center-h': {
        const centers = positions.map((p) => p.x + p.width / 2);
        const avg = Math.round(centers.reduce((a, b) => a + b, 0) / centers.length);
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, x: avg - el.position.width / 2 } } as any));
        break;
      }
      case 'right': {
        const maxR = Math.max(...positions.map((p) => p.x + p.width));
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, x: maxR - el.position.width } } as any));
        break;
      }
      case 'top': {
        const minY = Math.min(...positions.map((p) => p.y));
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, y: minY } } as any));
        break;
      }
      case 'center-v': {
        const centers = positions.map((p) => p.y + p.height / 2);
        const avg = Math.round(centers.reduce((a, b) => a + b, 0) / centers.length);
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, y: avg - el.position.height / 2 } } as any));
        break;
      }
      case 'bottom': {
        const maxB = Math.max(...positions.map((p) => p.y + p.height));
        alignableEls.forEach((el) => updateElement(el.id, { position: { ...el.position, y: maxB - el.position.height } } as any));
        break;
      }
    }
  };

  const distribute = (axis: 'h' | 'v') => {
    if (alignableEls.length < 3) return;
    const sorted = [...alignableEls].sort((a, b) =>
      axis === 'h' ? a.position.x - b.position.x : a.position.y - b.position.y
    );
    if (axis === 'h') {
      const first = sorted[0].position.x;
      const last = sorted[sorted.length - 1].position.x + sorted[sorted.length - 1].position.width;
      const totalWidth = sorted.reduce((s, el) => s + el.position.width, 0);
      const gap = (last - first - totalWidth) / (sorted.length - 1);
      let x = first;
      sorted.forEach((el) => {
        updateElement(el.id, { position: { ...el.position, x: Math.round(x) } } as any);
        x += el.position.width + gap;
      });
    } else {
      const first = sorted[0].position.y;
      const last = sorted[sorted.length - 1].position.y + sorted[sorted.length - 1].position.height;
      const totalHeight = sorted.reduce((s, el) => s + el.position.height, 0);
      const gap = (last - first - totalHeight) / (sorted.length - 1);
      let y = first;
      sorted.forEach((el) => {
        updateElement(el.id, { position: { ...el.position, y: Math.round(y) } } as any);
        y += el.position.height + gap;
      });
    }
  };

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

        {selectedObject?.type === 'multi' && multiEls.length > 0 && (
          <>
            <PropSection label="Selection">
              <span style={{ fontSize: 12 }}>{multiEls.length} elements selected</span>
            </PropSection>

            <PropSection label="Align">
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <button className="prop-zbtn" onClick={() => align('left')} title="Align left">⇤</button>
                <button className="prop-zbtn" onClick={() => align('center-h')} title="Align center horizontally">⟷</button>
                <button className="prop-zbtn" onClick={() => align('right')} title="Align right">⇥</button>
                <button className="prop-zbtn" onClick={() => align('top')} title="Align top">⤒</button>
                <button className="prop-zbtn" onClick={() => align('center-v')} title="Align center vertically">⟷</button>
                <button className="prop-zbtn" onClick={() => align('bottom')} title="Align bottom">⤓</button>
              </div>
            </PropSection>

            {alignableEls.length >= 3 && (
              <PropSection label="Distribute">
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="prop-zbtn" onClick={() => distribute('h')} title="Distribute horizontally">⇔</button>
                  <button className="prop-zbtn" onClick={() => distribute('v')} title="Distribute vertically">⇕</button>
                </div>
              </PropSection>
            )}

            <PropSection label="Actions">
              <button className="prop-zbtn" style={{ color: '#ef4444', fontSize: 12, width: 'auto', padding: '2px 8px' }}
                onClick={() => deleteElements(selectedObject.ids)} title="Delete all selected">
                Delete {multiEls.length}
              </button>
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
