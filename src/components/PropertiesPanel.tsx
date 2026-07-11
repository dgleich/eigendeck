import { useState, useEffect } from 'react';
import { usePresentationStore, pauseUndo, resumeUndo } from '../store/presentation';
import { TEXT_PRESET_STYLES, resolveNamedSize, effectiveFontSize, DEFAULT_TEXT_SIZES, parsePalette, textPresetBoxCss, type NamedSize } from '../types/presentation';
import { BUILT_IN_THEMES, resolveTheme } from '../lib/themes';
import { extractDemoPieceNames } from '../lib/demoPieces';
import { FONT_PACKAGES } from '../lib/fonts';
import { listMonoEligible } from '../lib/notebookFonts';
import type { VerticalAlign } from '../types/presentation';
import { AssetSection } from './AssetSection';
import { HelpText } from './HelpText';
import { usePreference } from '../lib/preferences';
import { OVERRIDDEN_DIM, overriddenLabel } from '../lib/overriddenStyle';
import { ColorControl } from './ColorControl';
import { TEXT_PALETTE, FILL_PALETTE, ARROW_PALETTE } from '../lib/colorPalettes';

/** Strip per-run inline text colors (the format toolbar's foreColor produces
 *  `<span style="color:…">` / `<font color>`) so the element-level Text Color
 *  governs the whole element uniformly. DOM-based so it handles nested markup. */
function stripInlineTextColors(html: string): string {
  if (typeof document === 'undefined' || !html) return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('*').forEach((node) => {
    const el = node as HTMLElement;
    el.style?.removeProperty('color');
    el.removeAttribute('color');                 // legacy <font color="…">
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  });
  return div.innerHTML;
}

export function PropertiesPanel() {
  const {
    presentation, currentSlideIndex, selectedObject, inspectorTab, setInspectorTab,
    updateSlide, updateElement, updateConfig, moveElementZ, deleteElements,
    freeElement, unlinkElement,
  } = usePresentationStore();

  // Padding sides start UNLINKED — most text elements have different top/bottom
  // vs left/right padding, so linked-by-default fought the common case.
  const [padLinked, setPadLinked] = useState(false);

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
  // `packages` lets the caller substitute a different registry (e.g.
  // MONO_FONT_PACKAGES for the Default Mono Font picker). Defaults to
  // the full text font registry.
  const FontSelect = ({ value, onChange, inheritLabel, packages }: {
    value: string | undefined;
    onChange: (v: string | undefined) => void;
    inheritLabel?: string;
    packages?: Array<{ id: string; label: string; family: string }>;
  }) => {
    const list: Array<{ id: string; label: string; family: string }> =
      packages ?? FONT_PACKAGES;
    return (
      <select className="prop-select" value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}>
        {inheritLabel && <option value="">{inheritLabel}</option>}
        {list.map((p) => (
          // Setting font-family on <option> is honored on macOS Safari/Chrome
          // for the dropdown panel (not the closed select), giving a visual
          // preview when the menu is open.
          <option key={p.id} value={p.id} style={{ fontFamily: p.family }}>
            {p.label}
          </option>
        ))}
      </select>
    );
  };

  const hasElementSel = !!selectedEl || multiEls.length > 0;
  // Effective tab: if 'element' is active but nothing is selected, show Slide.
  const tab: 'presentation' | 'slide' | 'element' =
    inspectorTab === 'element' && !hasElementSel ? 'slide' : inspectorTab;

  return (
    <div className="properties-panel">
      {/* Context switcher: the whole deck, this slide, or the selected element. */}
      <div className="properties-header" style={{ display: 'flex', gap: 0, padding: 0 }}>
        {(['presentation', 'slide', 'element'] as const).map((id) => {
          const label = id === 'presentation' ? 'Deck' : id === 'slide' ? 'Slide' : 'Element';
          const disabled = id === 'element' && !hasElementSel;
          const active = tab === id;
          return (
            <button key={id} disabled={disabled} onClick={() => setInspectorTab(id)}
              style={{
                flex: 1, padding: '7px 4px', fontSize: 12, fontWeight: active ? 600 : 400,
                border: 'none', borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
                background: active ? '#fff' : '#f3f4f6',
                color: disabled ? '#c4c8d0' : active ? '#111' : '#555',
                cursor: disabled ? 'default' : 'pointer',
              }}>
              {label}
            </button>
          );
        })}
      </div>
      <div className="properties-body">
        {tab === 'slide' && (
          <>
            {/* ── Slide ── */}
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
                        for (const el of slide.elements) if (el.syncId) freeElement(el.id);
                      }}
                      title="Free position of all elements on this slide">
                      Unsync All
                    </button>
                  )}
                  {slide.elements.some((el) => el.linkId) && (
                    <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '3px 8px' }}
                      onClick={() => {
                        for (const el of slide.elements) if (el.linkId) unlinkElement(el.id);
                      }}
                      title="Remove animation links from all elements on this slide">
                      Unlink All
                    </button>
                  )}
                </div>
              </PropSection>
            )}
          </>
        )}

        {tab === 'presentation' && (
          <>
            {/* ── Deck (presentation-wide) ── */}
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
            <PropSection label="Default Mono Font">
              <FontSelect value={presentation.config.defaultMonoFont}
                onChange={(v) => updateConfig({ defaultMonoFont: v })}
                inheritLabel="Source Code Pro (default)"
                packages={listMonoEligible()} />
            </PropSection>
            <PropSection label="Text sizes (px)">
              {/* Deck-level type scale — overrides DEFAULT_TEXT_SIZES.
                  Used by every element that picks a size by name
                  (notebooks, future text presets retrofit, etc.).
                  Blank cell = fall back to the built-in default. */}
              <TextSizesEditor config={presentation.config} updateConfig={updateConfig} />
            </PropSection>
            <PropSection label="Color Palette">
              {/* #2 — paste university/brand hex colors; they show as an extra
                  swatch row in the text-color toolbar. */}
              <PaletteEditor
                value={presentation.config.customPalette}
                onChange={(p) => updateConfig({ customPalette: p })} />
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
                deckToken={presentation.config.deckToken}
                onChange={(v) => updateConfig({ autoReloadAssets: v })} />
            </PropSection>
            <PropSection label="Security">
              <button
                className="prop-zbtn"
                style={{ textAlign: 'left', width: '100%', padding: '6px 10px' }}
                title="Review which files on your computer this deck links to, and approve or block them"
                onClick={() => void import('../lib/securityWindow').then((m) => m.openSecurityWindow())}>
                Linked files &amp; security…
              </button>
            </PropSection>
          </>
        )}

        {tab === 'element' && selectedObject?.type === 'multi' && multiEls.length > 0 && (
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

        {tab === 'element' && selectedEl && (
          <>
            <div className="prop-element-head">
              <span className="prop-element-type">{selectedEl.type.replace('-', ' ')}</span>
              {selectedEl.type === 'text' && (
                <span className="prop-element-sub">{selectedEl.preset}</span>
              )}
            </div>

            {/* Layer + Center first — layering is used a lot. */}
            <PropSection label="Layer">
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'bottom')} title="Move to bottom">⇊</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'down')} title="Move down">↓</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'up')} title="Move up">↑</button>
                <button className="prop-zbtn" onClick={() => moveElementZ(selectedEl.id, 'top')} title="Move to top">⇈</button>
              </div>
            </PropSection>
            {selectedEl.type !== 'arrow' && (
              <PropSection label="Center on slide">
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 8px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position, x: Math.round((1920 - selectedEl.position.width) / 2) } } as any)}
                    title="Center horizontally on slide">H</button>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 8px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position, y: Math.round((1080 - selectedEl.position.height) / 2) } } as any)}
                    title="Center vertically on slide">V</button>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 8px' }}
                    onClick={() => updateElement(selectedEl.id, { position: { ...selectedEl.position,
                      x: Math.round((1920 - selectedEl.position.width) / 2),
                      y: Math.round((1080 - selectedEl.position.height) / 2),
                    } } as any)}
                    title="Center both on slide">Both</button>
                </div>
              </PropSection>
            )}

            {/* Image element properties */}
            {selectedEl.type === 'image' && (
              <>
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
                        onPointerDown={pauseUndo} onPointerUp={resumeUndo}
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
                <PropSection label="Font size">
                  <FontSizeRow element={selectedEl}
                    updateElement={(id, ch) => updateElement(id, ch as any)}
                    config={presentation.config} />
                </PropSection>
                <PropSection label="Vertical Align">
                  <div style={{ display: 'flex', gap: 2 }}>
                    {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((va) => {
                      const current = selectedEl.verticalAlign || (selectedEl.preset === 'title' || selectedEl.preset === 'footnote' ? 'bottom' : 'top');
                      return (
                        <button key={va} className={`prop-zbtn ${current === va ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
                          onClick={() => updateElement(selectedEl.id, { verticalAlign: va } as any)}>
                          {va.charAt(0).toUpperCase() + va.slice(1)}
                        </button>
                      );
                    })}
                  </div>
                </PropSection>
                <PropSection label="Text Color">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <ColorControl
                      value={selectedEl.color === 'accent' ? undefined : selectedEl.color}
                      activeTint={selectedEl.color === 'accent' ? 'accent' : undefined}
                      palette={TEXT_PALETTE}
                      customPalette={presentation.config.customPalette}
                      allowNone noneLabel="Auto"
                      allowCustom
                      tint={{ kind: 'accent', theme: resolveTheme(presentation.theme, slide.theme) }}
                      onNone={() => updateElement(selectedEl.id, { color: undefined } as any)}
                      onColor={(c) => updateElement(selectedEl.id, { color: c } as any)}
                      onTint={() => updateElement(selectedEl.id, { color: 'accent' } as any)}
                    />
                    <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '2px 6px' }}
                      title="Remove per-word inline colors set with the format toolbar, so the whole element uses the Text Color above"
                      onClick={() => updateElement(selectedEl.id, { html: stripInlineTextColors(selectedEl.html) } as any)}>
                      Clear inline
                    </button>
                  </div>
                </PropSection>
                <PropSection label="Background">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <ColorControl
                      value={selectedEl.boxTint ? undefined : selectedEl.backgroundColor}
                      activeTint={selectedEl.boxTint}
                      palette={FILL_PALETTE}
                      customPalette={presentation.config.customPalette}
                      allowNone noneLabel="None"
                      allowCustom
                      tint={{ kind: 'fill', theme: resolveTheme(presentation.theme, slide.theme) }}
                      onNone={() => updateElement(selectedEl.id, { backgroundColor: undefined, backgroundOpacity: undefined, boxTint: undefined, boxShadow: undefined } as any)}
                      onColor={(c) => updateElement(selectedEl.id, { backgroundColor: c, boxTint: undefined } as any)}
                      onTint={(base) => updateElement(selectedEl.id, { boxTint: base, backgroundColor: undefined, backgroundOpacity: undefined } as any)}
                    />
                    {(selectedEl.backgroundColor || selectedEl.boxTint) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                        {/* Opacity applies to a fixed fill only (the themed tint is opaque). */}
                        {selectedEl.backgroundColor && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: '#374151' }}>Opacity</span>
                          <input type="range" min={0} max={1} step={0.05} value={selectedEl.backgroundOpacity ?? 1}
                            onPointerDown={pauseUndo} onPointerUp={resumeUndo}
                            onChange={(e) => updateElement(selectedEl.id, { backgroundOpacity: parseFloat(e.target.value) } as any)}
                            style={{ flex: 1, minWidth: 0, accentColor: '#2563eb' }} />
                          <input className="prop-num" type="number" min={0} max={100} step={1}
                            style={{ width: 32 }}
                            value={Math.round((selectedEl.backgroundOpacity ?? 1) * 100)}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (Number.isFinite(v)) updateElement(selectedEl.id, { backgroundOpacity: Math.max(0, Math.min(100, v)) / 100 } as any);
                            }} />
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>%</span>
                        </div>
                        )}
                        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
                          <input type="checkbox" checked={!!selectedEl.boxShadow}
                            onChange={(e) => updateElement(selectedEl.id, { boxShadow: e.target.checked || undefined } as any)} />
                          Box shadow
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: '#374151' }}>Rounded</span>
                          <input type="range" min={0} max={80} step={1} value={selectedEl.borderRadius ?? 0}
                            onPointerDown={pauseUndo} onPointerUp={resumeUndo}
                            onChange={(e) => updateElement(selectedEl.id, { borderRadius: parseInt(e.target.value, 10) || undefined } as any)}
                            style={{ flex: 1, minWidth: 0, accentColor: '#2563eb' }} />
                          <input className="prop-num" type="number" min={0} max={200} step={1}
                            style={{ width: 32 }}
                            value={selectedEl.borderRadius ?? 0}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              updateElement(selectedEl.id, { borderRadius: Number.isFinite(v) && v > 0 ? v : undefined } as any);
                            }} />
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>px</span>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#374151' }}>Padding</span>
                        <button className={`prop-zbtn ${padLinked ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '3px 10px' }}
                          title="Link: edit all four sides together"
                          onClick={() => setPadLinked(!padLinked)}>
                          Link
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                        {([['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']] as const).map(([side, lbl]) => {
                          const pb = textPresetBoxCss((selectedEl as any).preset || 'body');
                          const def = side === 'top' || side === 'bottom' ? pb.padY : pb.padX;
                          const cur = (selectedEl as any).padding as { top: number; right: number; bottom: number; left: number } | undefined;
                          const val = cur ? cur[side] : def;
                          return (
                            <label key={side} style={{ fontSize: 10, color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {lbl}
                              <input className="prop-num" type="number" min={0} max={400} value={val}
                                onChange={(e) => {
                                  const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                                  const base = cur ?? { top: pb.padY, right: pb.padX, bottom: pb.padY, left: pb.padX };
                                  const next = padLinked ? { top: v, right: v, bottom: v, left: v } : { ...base, [side]: v };
                                  updateElement(selectedEl.id, { padding: next } as any);
                                }} />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </PropSection>
                <PropSection label="Effect">
                  {/* #73 — legibility over busy backgrounds: drop shadow or a
                      high-contrast glow (halo auto-chosen vs the text color). */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {([['none', 'None'], ['shadow', 'Shadow'], ['glow', 'Glow']] as const).map(([val, label]) => {
                      const active = (selectedEl.textEffect ?? 'none') === val;
                      return (
                        <button key={val} className={`prop-zbtn ${active ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '3px 10px' }}
                          onClick={() => updateElement(selectedEl.id, { textEffect: val === 'none' ? undefined : val } as any)}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </PropSection>
                <PropSection label="Rotation">
                  {/* Tilt the whole text box (background + text), e.g. an angled
                      sticky-note Hype callout (#8). */}
                  <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="range" min={-45} max={45} step={1}
                      value={selectedEl.rotation || 0}
                      onPointerDown={pauseUndo} onPointerUp={resumeUndo}
                      onChange={(e) => updateElement(selectedEl.id, { rotation: parseInt(e.target.value) || 0 } as any)}
                      style={{ flex: 1 }} />
                    <input className="prop-input-sm" type="number" min={-180} max={180}
                      value={selectedEl.rotation || 0}
                      onChange={(e) => updateElement(selectedEl.id, { rotation: parseInt(e.target.value) || 0 } as any)}
                      style={{ width: 48 }} />
                    <span style={{ fontSize: 11, color: '#999' }}>&deg;</span>
                  </label>
                </PropSection>
              </>
            )}

            {selectedEl.type === 'demo-piece' && (
              <DemoPieceProperties element={selectedEl} />
            )}

            {selectedEl.type === 'video' && (
              <>
                <PropSection label="Playback">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.loop}
                        onChange={(e) => updateElement(selectedEl.id, { loop: e.target.checked } as any)} /> Loop
                    </label>
                    {selectedEl.kind === 'file' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input type="checkbox" checked={!!selectedEl.pingPong}
                          onChange={(e) => updateElement(selectedEl.id, { pingPong: e.target.checked } as any)} /> Ping-pong (reverse loop)
                      </label>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.autoplay}
                        onChange={(e) => updateElement(selectedEl.id, { autoplay: e.target.checked } as any)} /> Autoplay
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.controls}
                        onChange={(e) => updateElement(selectedEl.id, { controls: e.target.checked } as any)} /> Show controls
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.muted}
                        onChange={(e) => updateElement(selectedEl.id, { muted: e.target.checked } as any)} /> Muted
                    </label>
                    <label style={{ fontSize: 12 }}>Speed
                      <select value={selectedEl.playbackRate ?? 1}
                        onChange={(e) => updateElement(selectedEl.id, { playbackRate: parseFloat(e.target.value) } as any)}
                        style={{ marginLeft: 6, fontSize: 12 }}>
                        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}&times;</option>)}
                      </select>
                    </label>
                  </div>
                </PropSection>
                <PropSection label="Captions">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={!!selectedEl.captions}
                        onChange={(e) => updateElement(selectedEl.id, { captions: e.target.checked } as any)} /> Show captions
                    </label>
                    {selectedEl.kind === 'file' && (
                      <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '3px 8px' }}
                        onClick={async () => {
                          const { open } = await import('@tauri-apps/plugin-dialog');
                          const sel = await open({ title: 'Select captions (.vtt)', filters: [{ name: 'WebVTT', extensions: ['vtt'] }] });
                          if (!sel) return;
                          const full = sel as string;
                          try {
                            const { readAddFileCapped } = await import('../lib/assetInsert');
                            const { relPath } = await import('../App');
                            const bytes = await readAddFileCapped(full);
                            if (!bytes) return;  // over the size cap → toast shown
                            // externalPath keeps the source link so the .vtt is
                            // file-watched (edit captions on disk → they reload).
                            const relativePath = relPath(usePresentationStore.getState().projectPath, full);
                            const name = relativePath.split(/[\\/]/).pop() || 'captions.vtt';
                            const { storeAssetWithCollisionCheck } = await import('../lib/assetInsert');
                            const r = await storeAssetWithCollisionCheck({ path: relativePath, data: bytes, mimeType: 'text/vtt', externalPath: relativePath, externalMtime: null });
                            if (r.cancelled) return;
                            updateElement(selectedEl.id, { captionsAssetId: r.assetId, captions: true, captionsLabel: name.replace(/\.vtt$/i, '') } as any);
                          } catch (e) { console.error('attach captions failed:', e); }
                        }}>
                        {selectedEl.captionsAssetId ? 'Replace .vtt…' : 'Attach .vtt…'}
                      </button>
                    )}
                  </div>
                </PropSection>
              </>
            )}

            {selectedEl.type === 'notebook' && (
              <NotebookProperties element={selectedEl} />
            )}

            {selectedEl.type === 'arrow' && (
              <>
                <PropSection label="Color">
                  <ColorControl
                    value={selectedEl.color === 'accent' ? undefined : selectedEl.color}
                    activeTint={selectedEl.color === 'accent' ? 'accent' : undefined}
                    palette={ARROW_PALETTE}
                    customPalette={presentation.config.customPalette}
                    allowCustom
                    tint={{ kind: 'accent', theme: resolveTheme(presentation.theme, slide.theme) }}
                    onColor={(c) => updateElement(selectedEl.id, { color: c } as any)}
                    onTint={() => updateElement(selectedEl.id, { color: 'accent' } as any)}
                  />
                </PropSection>
                <PropSection label="Size">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {([['thin', 2, 10], ['normal', 4, 16], ['thick', 8, 26], ['super thick', 14, 40], ['really big', 22, 60]] as const).map(([lbl, sw, hs]) => {
                      const active = (selectedEl.strokeWidth || 4) === sw && (selectedEl.headSize || 16) === hs;
                      return (
                        <button key={lbl} className={`prop-zbtn ${active ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '3px 8px' }}
                          onClick={() => updateElement(selectedEl.id, { strokeWidth: sw, headSize: hs } as any)}>{lbl}</button>
                      );
                    })}
                  </div>
                </PropSection>
                <PropSection label="Heads">
                  <div style={{ display: 'flex', gap: 4 }}>
                    {([['end', 'End'], ['start', 'Start'], ['both', 'Both'], ['none', 'None']] as const).map(([val, lbl]) => {
                      const active = (selectedEl.heads ?? 'end') === val;
                      return (
                        <button key={val} className={`prop-zbtn ${active ? 'active' : ''}`}
                          style={{ fontSize: 11, width: 'auto', padding: '3px 10px' }}
                          onClick={() => updateElement(selectedEl.id, { heads: val } as any)}>{lbl}</button>
                      );
                    })}
                  </div>
                </PropSection>
                <PropSection label="Width">
                  <input className="prop-input-sm" type="number" value={selectedEl.strokeWidth || 4} min={1} max={40}
                    onChange={(e) => updateElement(selectedEl.id, { strokeWidth: parseInt(e.target.value) || 4 } as any)} />
                </PropSection>
                <PropSection label="Head Size">
                  <input className="prop-input-sm" type="number" value={selectedEl.headSize || 16} min={4} max={80}
                    onChange={(e) => updateElement(selectedEl.id, { headSize: parseInt(e.target.value) || 16 } as any)} />
                </PropSection>
                <PropSection label="Opacity">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="range" min={0} max={1} step={0.05} value={selectedEl.opacity ?? 1}
                      onPointerDown={pauseUndo} onPointerUp={resumeUndo}
                      onChange={(e) => updateElement(selectedEl.id, { opacity: parseFloat(e.target.value) } as any)}
                      style={{ flex: 1, minWidth: 0, accentColor: '#2563eb' }} />
                    <span style={{ fontSize: 11, color: '#999' }}>{Math.round((selectedEl.opacity ?? 1) * 100)}%</span>
                  </label>
                </PropSection>
              </>
            )}

            {selectedEl.type === 'cover' && (
              <PropSection label="Color">
                {/* A cover is a reveal mask. "Match" (no fill) matches the slide
                    background; a themed tint keeps a colored mask on-theme (#132). */}
                <ColorControl
                  value={selectedEl.boxTint ? undefined : selectedEl.color}
                  activeTint={selectedEl.boxTint}
                  palette={FILL_PALETTE}
                  customPalette={presentation.config.customPalette}
                  allowNone noneLabel="Match"
                  allowCustom
                  tint={{ kind: 'fill', theme: resolveTheme(presentation.theme, slide.theme) }}
                  onNone={() => updateElement(selectedEl.id, { color: undefined, boxTint: undefined } as any)}
                  onColor={(c) => updateElement(selectedEl.id, { color: c, boxTint: undefined } as any)}
                  onTint={(base) => updateElement(selectedEl.id, { boxTint: base, color: undefined } as any)}
                />
              </PropSection>
            )}

            {/* Cross-slide relationships — sync (same element, shared position)
                and animation links. Shown only when the element participates. */}
            {selectedEl.syncId && (
              <PropSection label="Synced">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#6b7280', flex: 1 }}>Same element across slides (shared position)</span>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '1px 6px' }}
                    onClick={() => freeElement(selectedEl.id)}
                    title="Free this instance — stop syncing its position">Unsync</button>
                </div>
              </PropSection>
            )}
            {selectedEl.linkId && (
              <PropSection label="Animated">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#6b7280', flex: 1 }}>Linked across slides for animation</span>
                  <button className="prop-zbtn" style={{ fontSize: 11, width: 'auto', padding: '1px 6px' }}
                    onClick={() => unlinkElement(selectedEl.id)}
                    title="Remove animation link to other slides">Unlink</button>
                </div>
              </PropSection>
            )}

            {/* Asset / source — set up once, then rarely touched, so it sits
                low (just above Position & Size). */}
            {'assetId' in selectedEl && selectedEl.assetId && (
              <PropSection label="Asset">
                <AssetSection assetId={selectedEl.assetId} elementId={selectedEl.id} />
              </PropSection>
            )}
            {selectedEl.type === 'video' && selectedEl.kind === 'embed' && (
              <PropSection label="Source">
                <div style={{ fontSize: 11, color: '#999', wordBreak: 'break-all' }}>
                  {selectedEl.provider} · {selectedEl.url}
                </div>
              </PropSection>
            )}

            {/* Position & Size — least-used, kept at the bottom behind a quiet divider. */}
            <div className="prop-divider" />
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
          </>
        )}
      </div>
    </div>
  );
}

function DemoPieceProperties({ element }: { element: Extract<import('../types/presentation').SlideElement, { type: 'demo-piece' }> }) {
  const { presentation, currentSlideIndex, addElement } = usePresentationStore();
  const [availablePieces, setAvailablePieces] = useState<string[]>([]);
  const [demoPath, setDemoPath] = useState<string>('');

  // Scan the demo HTML for available pieces; lookup also gives us the
  // path label for display. Both come from the bound asset.
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [data, meta] = await Promise.all([
          invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: element.assetId }),
          invoke<{ path: string | null } | null>('db_get_asset_meta_by_id', { assetId: element.assetId }),
        ]);
        setDemoPath(meta?.path ?? '');
        const html = new TextDecoder().decode(new Uint8Array(data));
        setAvailablePieces(extractDemoPieceNames(html));
      } catch { setAvailablePieces([]); }
    })();
  }, [element.assetId]);

  // Which pieces are already on this slide?
  const slide = presentation.slides[currentSlideIndex];
  const piecesOnSlide = new Set(
    slide.elements
      .filter((el) => el.type === 'demo-piece' && el.assetId === element.assetId)
      .map((el) => (el as typeof element).piece)
  );

  const missingPieces = availablePieces.filter((p) => !piecesOnSlide.has(p));

  return (
    <>
      <PropSection label="Demo">
        <span style={{ fontSize: 11, color: '#999', wordBreak: 'break-all' }}>{demoPath}</span>
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
                    assetId: element.assetId,
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

/**
 * Inspector controls for a notebook element. Cascade-aware: empty
 * fields fall through to deck default, then app default. Placeholder
 * text shows the effective resolved value so the user sees what's
 * currently in force.
 */
/** Deck-level type-scale editor — one row per named size with a
 *  px-value spinner. Blank cell falls through to DEFAULT_TEXT_SIZES.
 *  Setting a value to the default also strips the override so the
 *  cascade resumes (matches the default-setting cascade rules). */
/** #2 — paste a list of hex colors that become an extra row in the text-color
 *  toolbar (e.g. university brand colors). Live-parses; shows a swatch preview. */
function PaletteEditor({ value, onChange }: {
  value: string[] | undefined;
  onChange: (palette: string[] | undefined) => void;
}) {
  const [draft, setDraft] = useState((value ?? []).join('  '));
  // Resync when the deck's palette changes from elsewhere (load, undo).
  useEffect(() => { setDraft((value ?? []).join('  ')); }, [value]);
  const parsed = parsePalette(draft);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        className="prop-input"
        value={draft}
        placeholder="#0b3d91  #c8102e  #f5f5f5"
        spellCheck={false}
        rows={2}
        onChange={(e) => {
          setDraft(e.target.value);
          const p = parsePalette(e.target.value);
          onChange(p.length ? p : undefined);
        }}
        style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
      />
      {parsed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {parsed.map((c) => (
            <span key={c} title={c} style={{
              width: 18, height: 18, borderRadius: 3, background: c,
              border: '1px solid rgba(0,0,0,0.2)',
            }} />
          ))}
        </div>
      )}
      <HelpText inline style={{ fontSize: 10 }}>
        Paste hex colors (3- or 6-digit, with or without #). They appear as a
        swatch row when you edit text. {parsed.length} color{parsed.length === 1 ? '' : 's'}.
      </HelpText>
    </div>
  );
}

function TextSizesEditor({ config, updateConfig }: {
  config: import('../types/presentation').PresentationConfig;
  updateConfig: (changes: Partial<import('../types/presentation').PresentationConfig>) => void;
}) {
  const order: NamedSize[] = ['footnote', 'note', 'body', 'title', 'hype'];
  const overrides = config.textSizes ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {order.map((name) => {
        const fallback = DEFAULT_TEXT_SIZES[name];
        const current = overrides[name];
        const overridden = current != null;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#374151', width: 60 }}>{name}</span>
            <input
              type="number"
              min={8} max={200} step={1}
              // Always populate with the effective value (fallback when
              // no override) so the spinner steps from a sensible
              // number, not from blank. The "default Xpx" label and
              // its italic styling encode the override state instead.
              value={current ?? fallback}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = { ...overrides };
                if (raw === '') { delete next[name]; }
                else {
                  const v = parseInt(raw, 10);
                  if (!Number.isFinite(v) || v < 8 || v > 200) return;
                  // Matching the default — strip to keep the cascade alive.
                  if (v === fallback) delete next[name];
                  else next[name] = v;
                }
                updateConfig({
                  textSizes: Object.keys(next).length ? next : undefined,
                });
              }}
              style={{ width: 44, padding: '2px 4px', fontSize: 12 }}
            />
            <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: -2 }}>px</span>
            <HelpText inline style={{
              fontSize: 10,
              color: overridden ? '#9ca3af' : '#6b7280',
              marginLeft: 6,
              fontStyle: overridden ? 'normal' : 'italic',
            }}>
              default {fallback}px
            </HelpText>
          </div>
        );
      })}
    </div>
  );
}

/** Font-size picker — single row of named buttons + numeric spinner.
 *  Identical across element types: text and notebook elements both
 *  get the same widget so the user learns it once. `title` and
 *  `hype` are excluded from the named options for everyone — they're
 *  reserved (title) and decoration (hype). The numeric override
 *  reaches any value.
 *
 *  Notes on the cascade:
 *  - Click a named button → set fontSizeName, clear fontSize.
 *    Element follows the deck's textSizes[name] live.
 *  - Type in the spinner → set fontSize (numeric override),
 *    clear fontSizeName. Element is pinned to that exact px.
 *  - Typing a value that exactly matches a named size promotes
 *    back to the name so the cascade resumes.
 *
 *  For text elements, "no override" means the preset's default
 *  size applies (active button matches if preset's sizeName is
 *  body/note/footnote; otherwise none highlight — e.g. a title
 *  preset shows the spinner at 72 with no button highlighted).
 *  For notebooks, "no override" means 'note' (32 px).
 */
const NAMED_SIZE_OPTIONS: Array<Exclude<NamedSize, 'title' | 'hype'>> = ['body', 'note', 'footnote'];

function FontSizeRow({ element, updateElement, config }: {
  element: Extract<import('../types/presentation').SlideElement, { type: 'text' | 'notebook' }>;
  updateElement: (id: string, changes: Partial<typeof element>) => void;
  config: import('../types/presentation').PresentationConfig | undefined;
}) {
  const effective = effectiveFontSize(element, config);
  const isOverride = element.fontSize != null;
  // The px input keeps its own draft string so the user can clear it and type
  // multi-digit values whose intermediate states are out of range (e.g.
  // backspacing "48" to "4" to "36"). Committing only on a VALID value, and
  // the controlled-value-rejects-edits bug (#23) goes away. Resync from the
  // canonical size whenever it changes externally (named buttons, undo, sync).
  const [draft, setDraft] = useState(String(effective));
  useEffect(() => { setDraft(String(effective)); }, [effective]);
  // For text elements, the "no override" name is the preset's sizeName.
  // For notebooks, it's 'note'. Used for button highlighting only.
  const fallbackName: NamedSize =
    element.type === 'text'
      ? TEXT_PRESET_STYLES[element.preset].sizeName
      : 'note';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {NAMED_SIZE_OPTIONS.map((name) => {
        const px = resolveNamedSize(name, config);
        const active = !isOverride && (element.fontSizeName ?? fallbackName) === name;
        return (
          <button key={name}
            className={`prop-zbtn ${active ? 'active' : ''}`}
            style={{ padding: '4px 8px', fontSize: 11 }}
            onClick={() => updateElement(element.id, {
              // For text elements, when the named button matches the
              // preset's own sizeName we strip BOTH fields so the
              // cascade flows fully back through the preset. For
              // notebooks, 'note' is the implicit default, so the
              // same stripping applies.
              fontSizeName: name === fallbackName ? undefined : name,
              fontSize: undefined,
            } as Partial<typeof element>)}
            title={`${name} — ${px}px`}
          >
            {name}
          </button>
        );
      })}
      <input
        type="number"
        min={8} max={200} step={1}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);                       // always reflect what's typed
          const v = parseInt(raw, 10);
          if (!Number.isFinite(v) || v < 8 || v > 200) return;  // wait for a valid value
          const matchingName = NAMED_SIZE_OPTIONS.find(
            (n) => resolveNamedSize(n, config) === v,
          );
          if (matchingName) {
            updateElement(element.id, {
              fontSizeName: matchingName === fallbackName ? undefined : matchingName,
              fontSize: undefined,
            } as Partial<typeof element>);
          } else {
            updateElement(element.id, { fontSize: v, fontSizeName: undefined } as Partial<typeof element>);
          }
        }}
        onBlur={() => setDraft(String(effective))}  // snap a half-typed/invalid draft back
        className="prop-num"
        style={{ width: 44, marginLeft: 4 }}
        title="Custom size in pixels — overrides the named choice"
      />
      <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: -2 }}>px</span>
    </div>
  );
}

function NotebookProperties({ element }: {
  element: Extract<import('../types/presentation').SlideElement, { type: 'notebook' }>;
}) {
  const { presentation, updateElement } = usePresentationStore();
  const config = presentation.config;
  const [defaultNotebookEditable] = usePreference('defaultNotebookEditable');

  // Element-level kernel may be undefined; user changes promote it
  // to an explicit object. Per the cascade doc — the absence of a
  // value is meaningful (means "use deck default"), so we keep the
  // distinction visible in the UI. Note: server URL + token are NOT
  // on the element anymore (those live in the per-machine registry
  // in Settings → Jupyter servers, matched by kernel name).
  const elemKind = element.kernel?.kind ?? '';
  const elemExt = element.kernel?.kind === 'external' ? element.kernel : undefined;

  const setKernel = (k: typeof element.kernel | undefined) => {
    updateElement(element.id, { kernel: k } as Partial<typeof element>);
  };

  // Effective editability cascades: element override → global pref →
  // false. The toggle stores an explicit boolean so it overrides the
  // global default in either direction.
  const effectiveEditable = element.editable ?? defaultNotebookEditable;

  // Editable toggle is coupled to file-watching. Turning editing ON disables
  // auto-reload for the bound asset (so an in-deck edit can't be clobbered by a
  // disk-change reload). Turning it OFF deliberately LEAVES watching off —
  // taking control is sticky: the user re-enables Watch explicitly (Asset
  // section) when they want the notebook to follow the file again. The asset
  // keeps its external_path, so the Asset section's Watch checkbox and the
  // "Reload from disk" button still work (the latter drops the cellEdits
  // overlay; see NotebookContent).
  const setEditable = async (on: boolean) => {
    updateElement(element.id, { editable: on } as Partial<typeof element>);
    if (!on) return;  // un-editing keeps watching off — user re-enables it
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('db_set_asset_auto_reload', { assetId: element.assetId, value: 'off' });
    } catch (e) {
      console.error('Failed to disable asset auto_reload for editable notebook:', e);
    }
  };

  return (
    <>
      <PropSection label="Kernel backend">
        <select
          value={elemKind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') setKernel(undefined);
            else if (v === 'external') setKernel({ kind: 'external' });
          }}
          style={{ width: '100%', padding: '3px 6px', fontSize: 12 }}
        >
          <option value="">deck default</option>
          <option value="external">External Jupyter server</option>
        </select>
      </PropSection>

      {(elemKind === 'external' || elemKind === '') && (
        <PropSection label="Kernel name">
          <input
            type="text"
            value={elemExt?.kernelName ?? ''}
            placeholder="python3 (from notebook metadata)"
            onChange={(e) => {
              const v = e.target.value.trim();
              if (!element.kernel || element.kernel.kind !== 'external') {
                setKernel({ kind: 'external', kernelName: v || undefined });
              } else {
                setKernel({ ...element.kernel, kernelName: v || undefined });
              }
            }}
            style={{ width: '100%', padding: '3px 6px', fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
          <HelpText>
            Server URL + token live in Settings → Jupyter servers.
            The first registered server that advertises this kernel is the one we dial.
          </HelpText>
        </PropSection>
      )}

      <PropSection label="Editable">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={effectiveEditable}
            onChange={(e) => setEditable(e.target.checked)}
          />
          Allow editing code cells
        </label>
        <HelpText>
          Turning this on disables file-watching for this notebook
          (so your edits aren't overwritten by a disk reload). Use the
          Asset section's "Reload from disk" to pull the latest source
          — that discards in-deck edits.
          {element.editable === undefined && (
            <> Default ({defaultNotebookEditable ? 'on' : 'off'}) comes
            from Settings → General.</>
          )}
        </HelpText>
      </PropSection>


      <PropSection label="Syntax highlight code">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            // Default true (`undefined` => on). Only stored when the
            // user explicitly opts out.
            checked={element.syntaxHighlight !== false}
            onChange={(e) => updateElement(element.id, {
              syntaxHighlight: e.target.checked ? undefined : false,
            } as Partial<typeof element>)}
          />
          Color code by language (from kernel metadata)
        </label>
      </PropSection>

      <PropSection label="Display">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={element.hideMarkdown === true}
            onChange={(e) => updateElement(element.id, {
              hideMarkdown: e.target.checked ? true : undefined,
            } as Partial<typeof element>)}
          />
          Hide markdown cells (code only)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={element.hideHeader === true}
            onChange={(e) => updateElement(element.id, {
              hideHeader: e.target.checked ? true : undefined,
            } as Partial<typeof element>)}
          />
          Hide kernel header
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={element.showBorder === true}
            onChange={(e) => updateElement(element.id, {
              showBorder: e.target.checked ? true : undefined,
            } as Partial<typeof element>)}
          />
          Show frame border
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={element.showLineNumbers === true}
            onChange={(e) => updateElement(element.id, {
              showLineNumbers: e.target.checked ? true : undefined,
            } as Partial<typeof element>)}
          />
          Show line numbers
        </label>
      </PropSection>

      {/* Font size picker — single row matching the user's sketch:
          label, named buttons (body / note / footnote in that order —
          'title' is reserved for title text elements and isn't shown
          here), and a numeric spinner for arbitrary overrides.
          - Clicking a named button: sets fontSizeName, clears fontSize
            override. The cascade kicks in (deck textSizes → defaults).
          - Editing the spinner: sets fontSize (numeric override),
            clears fontSizeName. Buttons deactivate.
          The spinner always displays the EFFECTIVE size (whichever
          path resolves). */}
      <PropSection label="Font size">
        <FontSizeRow element={element}
          updateElement={(id, ch) => updateElement(id, ch as Partial<typeof element>)}
          config={config} />
      </PropSection>
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
          className="prop-zbtn" style={{ fontSize: 11 }}>
          Insert global
        </button>
        <button
          onClick={replaceWithGlobal}
          disabled={!globalPreamble}
          title={globalPreamble ? 'Replace this preamble with the global preamble' : 'Global preamble is empty (set in Settings…)'}
          className="prop-zbtn" style={{ fontSize: 11 }}>
          Replace with global
        </button>
      </div>
    </div>
  );
}

/** Two-state checkbox for the per-presentation "watch source files"
 *  setting. Stored as `config.autoReloadAssets`:
 *    undefined → follow global pref (the default; checkbox shows checked
 *                if global is on, unchecked if off)
 *    'off'     → opt out for this presentation regardless of global
 *
 *  Note the value domain is intentionally narrow: per-presentation 'on'
 *  is functionally meaningless under the downward-only cascade (no
 *  layer overrides a refusal above it), so we only express the opt-out.
 */
function AutoReloadAssetsControl({
  value,
  onChange,
  deckToken,
}: {
  value: 'on' | 'off' | undefined;
  onChange: (v: 'on' | 'off' | undefined) => void;
  deckToken?: string;
}) {
  const [globalDefault] = usePreference('autoReloadAssets');
  // An untrusted deck can't watch anything (docs/ASSETS-SECURITY.md) — a deck with no
  // token is untrusted by construction; a tokened one is trusted only if it's in the
  // ledger. Watching is moot until it's trusted, so we grey + uncheck the control and
  // say why. Refreshes when trust changes (approve in the Security window).
  const [trusted, setTrusted] = useState<boolean | null>(deckToken ? null : false);
  useEffect(() => {
    if (!deckToken) { setTrusted(false); return; }
    let alive = true;
    const load = () => import('../lib/trustStore').then((m) => m.isTrusted(deckToken))
      .then((t) => { if (alive) setTrusted(t); }).catch(() => { if (alive) setTrusted(false); });
    load();
    const onChanged = () => load();
    window.addEventListener('eigendeck:security-changed', onChanged);
    return () => { alive = false; window.removeEventListener('eigendeck:security-changed', onChanged); };
  }, [deckToken]);

  const untrusted = trusted === false;
  const optedOut = value === 'off';
  // Checked only when it will actually watch: trusted, not opted out, global on.
  const checked = !untrusted && value !== 'off' && globalDefault;
  const disabled = untrusted || (!globalDefault && !optedOut);

  // Overridden = disabled by a higher state/setting (untrusted deck OR global
  // watching off) — not the user's own per-deck opt-out. Shared grey+strike+dim
  // motif (docs/USER-FACING-MESSAGES.md); the help text below says which.
  const overridden = disabled;
  return (
    <div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer', opacity: overridden ? OVERRIDDEN_DIM : 1 }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? undefined : 'off')}
          style={{ marginTop: 2 }} />
        <span style={{ fontSize: 11, ...(overridden ? overriddenLabel : {}) }}>Watch source files for changes</span>
      </label>
      <HelpText style={{ fontSize: 10, marginTop: 4, marginLeft: 22 }}>
        {untrusted ? (
          <>Untrusted decks can’t watch assets. Approve files in Window → Deck Security Settings to enable this.</>
        ) : !globalDefault && !optedOut ? (
          <>Disabled because the global setting (Cmd+,) is off.</>
        ) : optedOut ? (
          <>Off: nothing in this presentation auto-updates when source files change.</>
        ) : (
          <>On: linked SVG / image assets reload when their source files change on disk.</>
        )}
      </HelpText>
    </div>
  );
}
