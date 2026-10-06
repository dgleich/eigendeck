import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ElementLinkBadges } from './SlideElementRenderer';
import { usePresentationStore } from '../store/presentation';
import { deriveSyncIds } from '../lib/syncLink';
import type { Slide, SlideElement } from '../types/presentation';

const el = (id: string, extra: Partial<SlideElement> = {}) =>
  ({ id, type: 'text', preset: 'body', html: id, position: { x: 0, y: 0, width: 10, height: 10 }, ...extra }) as SlideElement;
const sl = (id: string, elements: SlideElement[]) => ({ id, layout: 'default', notes: '', elements }) as unknown as Slide;
/** Put a deck in the store (syncId derived, as the store does) and show slide 0. */
function deck(...slides: Slide[]) {
  const st = usePresentationStore.getState();
  usePresentationStore.setState({
    presentation: { ...st.presentation, slides: deriveSyncIds(slides) }, currentSlideIndex: 0,
  });
  return usePresentationStore.getState().presentation.slides[0].elements[0];
}

// The sync/animation/link badge cluster is shared by DraggableBox and ArrowRenderer
// (#138 review) so arrows get the same link-authoring chrome as every other element.
describe('ElementLinkBadges', () => {
  beforeEach(() => { deck(sl('s0', [])); });
  it('renders nothing when the element is not selected', () => {
    const { container } = render(<ElementLinkBadges element={{ id: 'a' }} isSelected={false} />);
    expect(container.querySelector('.el-link-badges')).toBeNull();
  });

  it('shows the L (link) badge on any selected element — including an arrow-shaped one', () => {
    const { container } = render(<ElementLinkBadges element={{ id: 'a' }} isSelected />);
    expect(container.querySelector('.el-badge-link')).not.toBeNull();
    // No sync/animation partner → those badges stay hidden.
    expect(container.querySelector('.el-badge-sync')).toBeNull();
    expect(container.querySelector('.el-badge-anim')).toBeNull();
  });

  it('shows the animation (A) badge when the element has a link partner on another slide', () => {
    const a = deck(sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', [el('b', { linkId: 'L1' })]));
    const { container } = render(<ElementLinkBadges element={a} isSelected />);
    expect(container.querySelector('.el-badge-anim')).not.toBeNull();
  });
});

// Badge visibility is computed from the slides (docs/sync-and-link.md addendum;
// DESIGN_DECISIONS.md "Sync badge visibility"), never by pruning the ids on delete.
describe('ElementLinkBadges — computed visibility', () => {
  it('hides A on a lone linked element (its partner was deleted)', () => {
    const a = deck(sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', []));
    const { container } = render(<ElementLinkBadges element={a} isSelected />);
    expect(container.querySelector('.el-badge-anim')).toBeNull();
    expect(container.querySelector('.el-badge-off')).toBeNull();
  });

  it('hides A on a synced element (a synced element links only to itself)', () => {
    const a = deck(sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', [el('a', { linkId: 'L1' })]));
    expect(a.syncId).toBe('a');
    const { container } = render(<ElementLinkBadges element={a} isSelected />);
    expect(container.querySelector('.el-badge-sync')).not.toBeNull();
    expect(container.querySelector('.el-badge-anim')).toBeNull();
    expect(container.querySelectorAll('.el-badge-off')).toHaveLength(0);
  });

  it('shows a grey A (relink) only while another slide still carries the remembered link', () => {
    const a = deck(sl('s0', [el('a', { _linkId: 'L1' })]), sl('s1', [el('b', { linkId: 'L1' })]));
    const on = render(<ElementLinkBadges element={a} isSelected />);
    expect(on.container.querySelector('.el-badge-off')?.textContent).toBe('A');
    on.unmount();
    const b = deck(sl('s0', [el('a', { _linkId: 'L1' })]), sl('s1', [el('b')]));
    const off = render(<ElementLinkBadges element={b} isSelected />);
    expect(off.container.querySelector('.el-badge-off')).toBeNull();
  });

  it('shows a grey S (resync) only while the remembered element is on another slide', () => {
    const f = deck(sl('s0', [el('f', { _syncId: 'g' })]), sl('s1', [el('g')]));
    const on = render(<ElementLinkBadges element={f} isSelected />);
    expect(on.container.querySelector('.el-badge-off')?.textContent).toBe('S');
    on.unmount();
    // every other copy deleted: _syncId is kept (undo), but no badge shows
    const g = deck(sl('s0', [el('f', { _syncId: 'g' })]), sl('s1', []));
    const off = render(<ElementLinkBadges element={g} isSelected />);
    expect(off.container.querySelector('.el-badge-off')).toBeNull();
  });

  it('shows a grey S (promote) on a linked element with a partner and no remembered sync', () => {
    const a = deck(sl('s0', [el('a', { linkId: 'L1' })]), sl('s1', [el('b', { linkId: 'L1' })]));
    const { container } = render(<ElementLinkBadges element={a} isSelected />);
    expect(container.querySelector('.el-badge-off')?.textContent).toBe('S');
  });

  it('disables the L badge for a synced element (sync and link are mutually exclusive)', () => {
    const { container } = render(<ElementLinkBadges element={{ id: 'a', syncId: 'S1' }} isSelected />);
    expect((container.querySelector('.el-badge-link') as HTMLButtonElement).disabled).toBe(true);
  });
});
