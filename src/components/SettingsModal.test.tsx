import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { SettingsPanel } from './SettingsModal';

// Deep-link into a Settings tab (View → Customize Toolbar… → "UI & Toolbar").
// The "Toolbar buttons" heading is unique to the `ui` tab, so its presence is a
// reliable "this tab is active" probe.
afterEach(() => { cleanup(); window.location.hash = ''; });

describe('Settings deep-link (Customize Toolbar…)', () => {
  it('defaults to the General tab (no hash) — UI-tab content hidden', () => {
    window.location.hash = '';
    render(<SettingsPanel />);
    expect(screen.queryByText('Toolbar buttons')).toBeNull();
  });

  it('opens on the UI & Toolbar tab when the URL hash is #ui', () => {
    window.location.hash = 'ui';
    render(<SettingsPanel />);
    expect(screen.getByText('Toolbar buttons')).toBeTruthy();
  });

  it('switches to the UI tab when an already-open window gets the settings-tab event', () => {
    window.location.hash = '';
    render(<SettingsPanel />);
    expect(screen.queryByText('Toolbar buttons')).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent('eigendeck:settings-tab', { detail: 'ui' }));
    });
    expect(screen.getByText('Toolbar buttons')).toBeTruthy();
  });

  it('ignores an unknown tab payload', () => {
    window.location.hash = '';
    render(<SettingsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('eigendeck:settings-tab', { detail: 'bogus' }));
    });
    expect(screen.queryByText('Toolbar buttons')).toBeNull();
  });
});
