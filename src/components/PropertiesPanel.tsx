import { useState, useEffect } from 'react';
import { usePresentationStore } from '../store/presentation';
import { TEXT_PRESET_STYLES } from '../types/presentation';
import { BUILT_IN_THEMES } from '../lib/themes';
import { FONT_PACKAGES, type FontPackage } from '../lib/fonts';
import type { VerticalAlign } from '../types/presentation';
import { AssetSection } from './AssetSection';
import { usePreference, effectiveAutoReload } from '../lib/preferences';
import { showReenableWatchingDialog } from '../lib/reenableWatchingDialog';
import { invoke } from '@tauri-apps/api/core';

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

  // Reusable font dropdown. `inheritLabel` is shown as the empty option;
  // when set to undefined the value falls through to the parent default.
  const FontSelect = ({ value, onChange, inheritLabel }: {
    value: string | undefined;
    onChange: (v: string | undefined) => void;
    inheritLabel?: string;
  }) => (
    <select className="prop-select" value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}>
      {inheritLabel && <option value="">{inheritLabel}</option>}
      {FONT_PACKAGES.map((p: FontPackage) => (
        // Setting font-family on <option> is honored on macOS Safari/Chrome
        // for the dropdown panel (not the closed select), giving a visual
        // preview when the menu is open.
        <option key={p.id} value={p.id} style={{ fontFamily: p.family }}>
          {p.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="properties-panel">
      <div className="properties-header">Properties</div>
      <div className="properties-body">
        {(!selectedObject || selectedObject.type === 'slide') && (
          <>
            {/* ── Slide Properties ── */}
            <div className="prop-section-header">Slide</div>
            <PropSection label="Theme">
              <select className="prop-select" value={slide.theme || ''}
                onChange={(e) => updateSlide(currentSlideIndex, { theme: e.target.value || undefined })}>
                <option value="">Inherit ({BUILT_IN_THEMES[presentation.theme]?.label || 'White'})</option>
                {Object.entries(BUILT_IN_THEMES).map(([id, t]) => (
                  <option key={id} value={id}>{t.label}</option>
                ))}
              </select>
            </PropSection>
            <PropSection label="Title Font">
              <FontSelect value={slide.titleFont}
                onChange={(v) => updateSlide(currentSlideIndex, { titleFont: v })}
                inheritLabel="Inherit (presentation default)" />
            </PropSection>
            <PropSection label="Body Font">
              <FontSelect value={slide.bodyFont}
                onChange={(v) => updateSlide(currentSlideIndex, { bodyFont: v })}
                inheritLabel="Inherit (presentation default)" />
            </PropSection>
            <PropSection label="Hype Font">
              <FontSelect value={slide.hypeFont}
                onChange={(v) => updateSlide(currentSlideIndex, { hypeFont: v })}
                inheritLabel="Inherit (presentation default)" />
            </PropSection>
            {slide.elements.some((el) => el.syncId || el.linkId) && (
              <PropSection label="Links">
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {slide.elements.some((el) => el.syncId) && (
                    <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '3px 8px' }}
                      onClick={() => {
                        for (const el of slide.elements) {
                          if (el.syncId) updateElement(el.id, { syncId: undefined, _syncId: el.syncId } as any);
                        }
                      }}
                      title="Free position of all elements on this slide">
                      Unsync All
                    </button>
                  )}
                  {slide.elements.some((el) => el.linkId) && (
                    <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '3px 8px' }}
                      onClick={() => {
                        for (const el of slide.elements) {
                          if (el.linkId) updateElement(el.id, { linkId: undefined, _linkId: el.linkId } as any);
                        }
                      }}
                      title="Remove animation links from all elements on this slide">
                      Unlink All
                    </button>
                  )}
                </div>
              </PropSection>
            )}

            {/* ── Presentation Properties ── */}
            <div id="presentation-prop-block" className="prop-section-header" style={{ marginTop: 12 }}>Presentation</div>
            <PropSection label="Default Theme">
              <select className="prop-select" value={presentation.theme || 'white'}
                onChange={(e) => usePresentationStore.getState().setTheme(e.target.value)}>
                {Object.entries(BUILT_IN_THEMES).map(([id, t]) => (
                  <option key={id} value={id}>{t.label}</option>
                ))}
              </select>
            </PropSection>
            <PropSection label="Default Title Font">
              <FontSelect value={presentation.config.defaultTitleFont}
                onChange={(v) => updateConfig({ defaultTitleFont: v })}
                inheritLabel="PT Sans (default)" />
            </PropSection>
            <PropSection label="Default Body Font">
              <FontSelect value={presentation.config.defaultBodyFont}
                onChange={(v) => updateConfig({ defaultBodyFont: v })}
                inheritLabel="PT Sans (default)" />
            </PropSection>
            <PropSection label="Default Hype Font">
              <FontSelect value={presentation.config.defaultHypeFont}
                onChange={(v) => updateConfig({ defaultHypeFont: v })}
                inheritLabel="PT Sans (default)" />
            </PropSection>
            <PropSection label="Author">
              <input className="prop-input" value={presentation.config.author || ''}
                onChange={(e) => updateConfig({ author: e.target.value })} />
            </PropSection>
            <PropSection label="Venue">
              <input className="prop-input" value={presentation.config.venue || ''}
                onChange={(e) => updateConfig({ venue: e.target.value })} />
            </PropSection>
            <PropSection label="LaTeX Preamble">
              <PreambleField
                value={presentation.config.mathPreamble || ''}
                onChange={(v) => updateConfig({ mathPreamble: v })} />
            </PropSection>
            <PropSection label="Auto-reload Assets">
              <AutoReloadAssetsControl
                value={presentation.config.autoReloadAssets}
                onChange={(v) => updateConfig({ autoReloadAssets: v })} />
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

            {/* Position: center on slide */}
            {selectedEl.type !== 'arrow' && (
              <PropSection label="Position">
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position, x: Math.round((1920 - selectedEl.position.width) / 2) } } as any)}
                    title="Center horizontally on slide">Center H</button>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position, y: Math.round((1080 - selectedEl.position.height) / 2) } } as any)}
                    title="Center vertically on slide">Center V</button>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position,
                      x: Math.round((1920 - selectedEl.position.width) / 2),
                      y: Math.round((1080 - selectedEl.position.height) / 2),
                    } } as any)}
                    title="Center both on slide">Center</button>
                </div>
              </PropSection>
            )}

            {/* Link status */}
            {selectedEl.linkId && (
              <PropSection label="Linked">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#999' }}>{selectedEl.linkId.slice(0, 8)}</span>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '1px 6px' }}
                    onClick={() => updateElement(selectedEl.id, { linkId: undefined } as any)}
                    title="Remove link to other slides">Unlink</button>
                </div>
              </PropSection>
            )}

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

            {/* Image element properties */}
            {selectedEl.type === 'image' && (
              <>
                <PropSection label="Asset">
                  <AssetSection srcPath={selectedEl.src} assetId={(selectedEl as { assetId?: string }).assetId} />
                </PropSection>
                <PropSection label="Effects">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.shadow}
                        onChange={(e) => updateElement(selectedEl.id, { shadow: e.target.checked } as any)} />
                      Drop Shadow
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Rounded Corners
                      <input className="prop-input-sm" type="number" min={0} max={100}
                        value={selectedEl.borderRadius || 0}
                        onChange={(e) => updateElement(selectedEl.id, { borderRadius: parseInt(e.target.value) || 0 } as any)}
                        style={{ marginLeft: 6, width: 50 }} />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Opacity
                      <input type="range" min={0} max={1} step={0.05}
                        value={selectedEl.opacity ?? 1}
                        onChange={(e) => updateElement(selectedEl.id, { opacity: parseFloat(e.target.value) } as any)}
                        style={{ marginLeft: 6, width: 80 }} />
                      <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{Math.round((selectedEl.opacity ?? 1) * 100)}%</span>
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Rotation
                      <input className="prop-input-sm" type="number" min={-180} max={180}
                        value={selectedEl.rotation || 0}
                        onChange={(e) => updateElement(selectedEl.id, { rotation: parseInt(e.target.value) || 0 } as any)}
                        style={{ marginLeft: 6, width: 50 }} />
                      <span style={{ fontSize: 11, color: '#999' }}>&deg;</span>
                    </label>
                  </div>
                </PropSection>
              </>
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
                <PropSection label="Vertical Align">
                  <div style={{ display: 'flex', gap: 2 }}>
                    {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((va) => {
                      const current = selectedEl.verticalAlign || (selectedEl.preset === 'title' || selectedEl.preset === 'footnote' ? 'bottom' : 'top');
                      return (
                        <button key={va} className={`prop-zbtn ${current === va ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '2px 6px', background: current === va ? '#3b82f6' : undefined, color: current === va ? '#fff' : undefined }}
                          onClick={() => updateElement(selectedEl.id, { verticalAlign: va } as any)}>
                          {va.charAt(0).toUpperCase() + va.slice(1)}
                        </button>
                      );
                    })}
                  </div>
                </PropSection>
              </>
            )}

            {selectedEl.type === 'demo-piece' && (
              <DemoPieceProperties element={selectedEl} />
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

function DemoPieceProperties({ element }: { element: Extract<import('../types/presentation').SlideElement, { type: 'demo-piece' }> }) {
  const { presentation, currentSlideIndex, addElement } = usePresentationStore();
  const [availablePieces, setAvailablePieces] = useState<string[]>([]);

  // Scan the demo HTML for available pieces (from SQLite asset)
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const data = await invoke<number[]>('db_get_asset', { path: element.demoSrc });
        const html = new TextDecoder().decode(new Uint8Array(data));
        const matches = html.matchAll(/piece\s*===?\s*['"](\w+)['"]/g);
        const pieces = [...new Set([...matches].map((m: RegExpMatchArray) => m[1]))];
        setAvailablePieces(pieces);
      } catch { setAvailablePieces([]); }
    })();
  }, [element.demoSrc]);

  // Which pieces are already on this slide?
  const slide = presentation.slides[currentSlideIndex];
  const piecesOnSlide = new Set(
    slide.elements
      .filter((el) => el.type === 'demo-piece' && el.demoSrc === element.demoSrc)
      .map((el) => (el as typeof element).piece)
  );

  const missingPieces = availablePieces.filter((p) => !piecesOnSlide.has(p));

  return (
    <>
      <PropSection label="Demo">
        <span style={{ fontSize: 11, color: '#999', wordBreak: 'break-all' }}>{element.demoSrc}</span>
      </PropSection>
      <PropSection label="Piece">
        <span style={{ fontSize: 12, fontWeight: 600 }}>{element.piece}</span>
      </PropSection>
      {missingPieces.length > 0 && (
        <PropSection label="Add Piece">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {missingPieces.map((piece) => (
              <button key={piece} className="prop-zbtn"
                style={{ fontSize: 12, width: 'auto', padding: '3px 8px', textAlign: 'left' }}
                onClick={() => {
                  addElement({
                    id: crypto.randomUUID(),
                    type: 'demo-piece' as any,
                    demoSrc: element.demoSrc,
                    piece,
                    position: { x: element.position.x + element.position.width + 40, y: element.position.y, width: 500, height: element.position.height },
                  });
                }}
                title={`Add "${piece}" piece to this slide`}
              >
                + {piece}
              </button>
            ))}
          </div>
        </PropSection>
      )}
    </>
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

function PreambleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [globalPreamble] = usePreference('mathPreamble');
  const insertGlobal = () => {
    if (!globalPreamble) return;
    const sep = value && !value.endsWith('\n') ? '\n' : '';
    onChange(globalPreamble + (globalPreamble.endsWith('\n') ? '' : '\n') + sep + value);
  };
  const replaceWithGlobal = () => {
    if (value && !confirm('Replace this presentation\'s preamble with the global preamble? Current text will be lost.')) return;
    onChange(globalPreamble);
  };
  return (
    <div>
      <textarea className="prop-input" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="\\newcommand{\\R}{\\mathbb{R}}"
        style={{ fontFamily: 'monospace', fontSize: 11, minHeight: 60, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={insertGlobal}
          disabled={!globalPreamble}
          title={globalPreamble ? 'Prepend the global preamble to this one' : 'Global preamble is empty (set in Settings…)'}
          style={{
            padding: '3px 8px', fontSize: 11,
            background: '#f3f4f6', color: globalPreamble ? '#222' : '#999',
            border: '1px solid #ddd', borderRadius: 3,
            cursor: globalPreamble ? 'pointer' : 'not-allowed',
          }}>
          Insert global
        </button>
        <button
          onClick={replaceWithGlobal}
          disabled={!globalPreamble}
          title={globalPreamble ? 'Replace this preamble with the global preamble' : 'Global preamble is empty (set in Settings…)'}
          style={{
            padding: '3px 8px', fontSize: 11,
            background: '#f3f4f6', color: globalPreamble ? '#222' : '#999',
            border: '1px solid #ddd', borderRadius: 3,
            cursor: globalPreamble ? 'pointer' : 'not-allowed',
          }}>
          Replace with global
        </button>
      </div>
    </div>
  );
}

function AutoReloadAssetsControl({
  value,
  onChange,
}: {
  value: 'on' | 'off' | undefined;
  onChange: (v: 'on' | 'off' | undefined) => void;
}) {
  const [globalDefault] = usePreference('autoReloadAssets');
  const current: 'default' | 'on' | 'off' = value ?? 'default';
  const options: Array<{ k: 'default' | 'on' | 'off'; label: string }> = [
    { k: 'default', label: `Follow global (${globalDefault ? 'on' : 'off'})` },
    { k: 'on', label: 'Always' },
    { k: 'off', label: 'Never' },
  ];

  const handleClick = async (k: 'default' | 'on' | 'off') => {
    if (k === current) return;
    const newPres: 'on' | 'off' | null = k === 'default' ? null : k;
    const effectiveBefore = effectiveAutoReload(null, value ?? null, globalDefault);
    const effectiveAfter = effectiveAutoReload(null, newPres, globalDefault);
    if (!effectiveBefore && effectiveAfter) {
      // OFF -> ON transition for the presentation. User previously
      // opted out (or never opted in); confirm what they want to happen
      // to assets added during the OFF window.
      const choice = await showReenableWatchingDialog();
      if (choice === 'cancel') return;
      if (choice === 'new-only') {
        // Snapshot the current OFF state onto each existing asset that
        // was implicitly following the cascade, so flipping per-pres to
        // ON doesn't surprise the user by suddenly auto-updating them.
        await disableImplicitAutoReloadForExistingAssets();
      }
      onChange(k === 'default' ? undefined : k);
      if (choice === 'rescan-all') {
        // Per-pres is now ON; trigger the scan to catch up on disk
        // drift that accumulated while we weren't watching. Same code
        // path that runs at project open.
        await rescanLinkedAssets();
      }
      return;
    }
    onChange(k === 'default' ? undefined : k);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map(({ k, label }) => (
          <button key={k}
            onClick={() => { void handleClick(k); }}
            style={{
              padding: '3px 8px', fontSize: 11,
              background: current === k ? '#3b82f6' : '#f3f4f6',
              color: current === k ? '#fff' : '#222',
              border: '1px solid #ddd', borderRadius: 3,
              cursor: 'pointer',
            }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
        Reload linked SVG / image assets when their source files change on disk.
        Per-asset settings (in Image properties) still override this.
      </div>
    </div>
  );
}

interface LinkedAssetRow {
  asset_id: string;
  path: string | null;
  external_path: string;
  external_mtime: string | null;
  auto_reload: string | null;
  mime_type: string | null;
}

/** Set per-asset auto_reload='off' on every linked asset whose
 *  auto_reload is currently null (i.e. implicitly following the
 *  cascade). Leaves assets the user explicitly flipped 'on' or 'off'
 *  untouched — those choices were intentional. */
async function disableImplicitAutoReloadForExistingAssets(): Promise<void> {
  const linked = await invoke<LinkedAssetRow[]>('db_list_linked_assets').catch(() => [] as LinkedAssetRow[]);
  for (const a of linked) {
    if (a.auto_reload === null) {
      await invoke('db_set_asset_auto_reload', { assetId: a.asset_id, value: 'off' }).catch(() => {});
    }
  }
}

/** Trigger the same scan-on-load behavior used at project open, so
 *  assets that drifted on disk while watching was off get pulled now. */
async function rescanLinkedAssets(): Promise<void> {
  const store = usePresentationStore.getState();
  if (!store.projectPath) return;
  const { scanForChangedAssets, dirname } = await import('../lib/watcherRegistry');
  const presOverride = store.presentation?.config?.autoReloadAssets ?? null;
  await scanForChangedAssets(dirname(store.projectPath), presOverride).catch(() => {});
}
