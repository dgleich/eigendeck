/**
 * Multi-monitor presenter support.
 *
 * Detects secondary monitors, opens a presenter window on the projector,
 * and coordinates navigation via Tauri events.
 */
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo, listen } from '@tauri-apps/api/event';
import type { Presentation } from '../types/presentation';

let presenterWindow: WebviewWindow | null = null;
let navigationListener: (() => void) | null = null;

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

/**
 * Detect available monitors and identify the best one for presenting.
 * Returns null if only one monitor is available.
 */
export async function detectProjector(): Promise<MonitorInfo | null> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length <= 1) return null;

    const primary = await currentMonitor();
    const primaryName = primary?.name || '';

    // Find the non-primary monitor — prefer one with "projector" or "external" in name
    for (const m of monitors) {
      if (m.name !== primaryName) {
        const nameLower = (m.name || '').toLowerCase();
        if (nameLower.includes('projector') || nameLower.includes('external')) {
          return {
            name: m.name || 'External',
            width: m.size.width,
            height: m.size.height,
            x: m.position.x,
            y: m.position.y,
            isPrimary: false,
          };
        }
      }
    }

    // Fall back to any non-primary monitor
    for (const m of monitors) {
      if (m.name !== primaryName) {
        return {
          name: m.name || 'External',
          width: m.size.width,
          height: m.size.height,
          x: m.position.x,
          y: m.position.y,
          isPrimary: false,
        };
      }
    }
  } catch (e) {
    console.error('Monitor detection failed:', e);
  }
  return null;
}

/**
 * Open the presenter window on the given monitor (or detected projector).
 * Returns true if a second window was opened, false if single-monitor fallback.
 */
export async function openPresenterWindow(
  presentation: Presentation,
  currentIndex: number,
  projectPath: string | null
): Promise<boolean> {
  const projector = await detectProjector();

  if (!projector) {
    return false; // Single monitor — caller should use in-window presenter
  }

  try {
    // Close existing presenter window if any
    await closePresenterWindow();

    // Create presenter window on the secondary monitor
    presenterWindow = new WebviewWindow('presenter', {
      url: '/presenter.html',
      title: 'Eigendeck Presenter',
      x: projector.x,
      y: projector.y,
      width: projector.width,
      height: projector.height,
      fullscreen: true,
      decorations: false,
      alwaysOnTop: true,
      focus: false, // Keep focus on main window for speaker controls
    });

    // Wait for the presenter window to signal ready
    const readyPromise = new Promise<void>((resolve) => {
      listen('presenter:ready', () => resolve()).then((unlisten) => {
        // Clean up after ready
        setTimeout(unlisten, 5000);
      });
    });

    // Wait for window creation + ready signal (with timeout)
    await Promise.race([
      readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Presenter window timeout')), 5000)),
    ]);

    // Send presentation data
    await emitTo('presenter', 'presenter:init', {
      presentation,
      currentIndex,
      projectPath,
    });

    return true;
  } catch (e) {
    console.error('Failed to open presenter window:', e);
    await closePresenterWindow();
    return false;
  }
}

/**
 * Navigate the presenter window to a specific slide.
 */
export async function navigatePresenter(index: number): Promise<void> {
  if (!presenterWindow) return;
  try {
    await emitTo('presenter', 'presenter:goto', { index });
  } catch (e) {
    console.error('Failed to navigate presenter:', e);
  }
}

/**
 * Update the presentation data in the presenter window.
 */
export async function updatePresenterData(presentation: Presentation): Promise<void> {
  if (!presenterWindow) return;
  try {
    await emitTo('presenter', 'presenter:update', { presentation });
  } catch (e) {
    console.error('Failed to update presenter:', e);
  }
}

/**
 * Close the presenter window.
 */
export async function closePresenterWindow(): Promise<void> {
  if (presenterWindow) {
    try {
      await presenterWindow.close();
    } catch { /* already closed */ }
    presenterWindow = null;
  }
  if (navigationListener) {
    navigationListener();
    navigationListener = null;
  }
}

/**
 * Check if a presenter window is currently open.
 */
export function isPresenterOpen(): boolean {
  return presenterWindow !== null;
}
