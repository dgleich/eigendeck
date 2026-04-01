import { usePresentationStore } from '../store/presentation';
import type { SlideLayout } from '../types/presentation';

const TRANSITIONS = [
  { id: 'slide', label: 'Slide' },
  { id: 'fade', label: 'Fade' },
  { id: 'convex', label: 'Convex' },
  { id: 'concave', label: 'Concave' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'none', label: 'None' },
];

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
    presentation,
    currentSlideIndex,
    selectedObject,
    updateSlide,
    updateSlideContent,
    updateConfig,
  } = usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide) return null;

  return (
    <div className="properties-panel">
      <div className="properties-header">
        Properties
      </div>
      <div className="properties-body">
        {(!selectedObject || selectedObject.type === 'slide') && (
          <SlideProperties
            slide={slide}
            slideIndex={currentSlideIndex}
            config={presentation.config}
            updateSlide={updateSlide}
            updateConfig={updateConfig}
          />
        )}
        {selectedObject?.type === 'title' && slide.content.title && (
          <TitleProperties
            title={slide.content.title}
            slideIndex={currentSlideIndex}
            updateSlideContent={updateSlideContent}
          />
        )}
        {selectedObject?.type === 'image' && (
          <ImageProperties
            position={slide.content.imagePosition}
            slideIndex={currentSlideIndex}
            updateSlideContent={updateSlideContent}
          />
        )}
        {selectedObject?.type === 'textBox' && (
          <TextBoxProperties
            boxId={selectedObject.id}
            slide={slide}
            slideIndex={currentSlideIndex}
            updateSlideContent={updateSlideContent}
          />
        )}
        {selectedObject?.type === 'arrow' && (
          <ArrowProperties
            arrowId={selectedObject.id}
            slide={slide}
            slideIndex={currentSlideIndex}
            updateSlideContent={updateSlideContent}
          />
        )}
      </div>
    </div>
  );
}

function SlideProperties({ slide, slideIndex, config, updateSlide, updateConfig }: any) {
  return (
    <>
      <div className="prop-section">
        <div className="prop-label">Layout</div>
        <select
          className="prop-select"
          value={slide.layout || 'default'}
          onChange={(e) => updateSlide(slideIndex, { layout: e.target.value })}
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>
      <div className="prop-section">
        <div className="prop-label">Transition</div>
        <select
          className="prop-select"
          value={config.transition || 'slide'}
          onChange={(e) => updateConfig({ transition: e.target.value })}
        >
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="prop-section">
        <div className="prop-label">Background</div>
        <input
          type="color"
          className="prop-color"
          value="#ffffff"
          title="Slide background color"
        />
      </div>
    </>
  );
}

function TitleProperties({ title, slideIndex, updateSlideContent }: any) {
  const update = (changes: any) => {
    updateSlideContent(slideIndex, {
      title: { ...title, ...changes, position: { ...title.position, ...(changes.position || {}) } },
    });
  };

  return (
    <>
      <div className="prop-section">
        <div className="prop-label">Title</div>
        <input
          className="prop-input"
          value={title.text}
          onChange={(e) => update({ text: e.target.value })}
        />
      </div>
      <div className="prop-section">
        <div className="prop-label">Font Size</div>
        <input
          className="prop-input-sm"
          type="number"
          value={title.fontSize || 56}
          onChange={(e) => update({ fontSize: parseInt(e.target.value) || 56 })}
        />
      </div>
      <PositionFields position={title.position} onChange={(pos: any) => update({ position: pos })} />
    </>
  );
}

function ImageProperties({ position, slideIndex, updateSlideContent }: any) {
  const pos = position || { x: 0, y: 0, width: 800, height: 600 };
  return (
    <PositionFields
      position={pos}
      onChange={(newPos: any) => updateSlideContent(slideIndex, { imagePosition: newPos })}
    />
  );
}

function TextBoxProperties({ boxId, slide, slideIndex, updateSlideContent }: any) {
  const boxes = slide.content.textBoxes || [];
  const box = boxes.find((b: any) => b.id === boxId);
  if (!box) return null;

  const update = (changes: any) => {
    const updated = boxes.map((b: any) =>
      b.id === boxId ? { ...b, ...changes, position: { ...b.position, ...(changes.position || {}) } } : b
    );
    updateSlideContent(slideIndex, { textBoxes: updated });
  };

  return (
    <PositionFields position={box.position} onChange={(pos: any) => update({ position: pos })} />
  );
}

function ArrowProperties({ arrowId, slide, slideIndex, updateSlideContent }: any) {
  const arrows = slide.content.arrows || [];
  const arrow = arrows.find((a: any) => a.id === arrowId);
  if (!arrow) return null;

  const update = (changes: any) => {
    const updated = arrows.map((a: any) =>
      a.id === arrowId ? { ...a, ...changes } : a
    );
    updateSlideContent(slideIndex, { arrows: updated });
  };

  return (
    <>
      <div className="prop-section">
        <div className="prop-label">Color</div>
        <div className="prop-color-row">
          {ARROW_COLORS.map((c) => (
            <button
              key={c}
              className={`prop-color-swatch ${arrow.color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => update({ color: c })}
            />
          ))}
        </div>
      </div>
      <div className="prop-section">
        <div className="prop-label">Width</div>
        <input
          className="prop-input-sm"
          type="number"
          value={arrow.strokeWidth || 4}
          min={1}
          max={20}
          onChange={(e) => update({ strokeWidth: parseInt(e.target.value) || 4 })}
        />
      </div>
      <div className="prop-section">
        <div className="prop-label">Head Size</div>
        <input
          className="prop-input-sm"
          type="number"
          value={arrow.headSize || 16}
          min={4}
          max={40}
          onChange={(e) => update({ headSize: parseInt(e.target.value) || 16 })}
        />
      </div>
    </>
  );
}

function PositionFields({ position, onChange }: { position: any; onChange: (pos: any) => void }) {
  return (
    <div className="prop-section">
      <div className="prop-label">Position & Size</div>
      <div className="prop-grid">
        <label>X <input className="prop-input-sm" type="number" value={position.x}
          onChange={(e) => onChange({ ...position, x: parseInt(e.target.value) || 0 })} /></label>
        <label>Y <input className="prop-input-sm" type="number" value={position.y}
          onChange={(e) => onChange({ ...position, y: parseInt(e.target.value) || 0 })} /></label>
        <label>W <input className="prop-input-sm" type="number" value={position.width}
          onChange={(e) => onChange({ ...position, width: parseInt(e.target.value) || 100 })} /></label>
        <label>H <input className="prop-input-sm" type="number" value={position.height}
          onChange={(e) => onChange({ ...position, height: parseInt(e.target.value) || 100 })} /></label>
      </div>
    </div>
  );
}
