import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ElementLinkBadges } from './SlideElementRenderer';

// The sync/animation/link badge cluster is shared by DraggableBox and ArrowRenderer
// (#138 review) so arrows get the same link-authoring chrome as every other element.
describe('ElementLinkBadges', () => {
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

  it('shows the animation (A) badge when the element carries a linkId', () => {
    const { container } = render(<ElementLinkBadges element={{ id: 'a', linkId: 'L1' }} isSelected />);
    expect(container.querySelector('.el-badge-anim')).not.toBeNull();
  });

  it('disables the L badge for a synced element (sync and link are mutually exclusive)', () => {
    const { container } = render(<ElementLinkBadges element={{ id: 'a', syncId: 'S1' }} isSelected />);
    expect((container.querySelector('.el-badge-link') as HTMLButtonElement).disabled).toBe(true);
  });
});
