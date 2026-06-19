/**
 * Multi-monitor presenter support.
 *
 * Detects secondary monitors, opens a presenter window on the projector,
 * and coordinates navigation via Tauri events.
 */
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Monitor } from '@tauri-apps/api/window';
import type { Presentation } from '../types/presentation';

let presenterWindow: WebviewWindow | null = null;
let navigationListener: (() => void) | null = null;
let wasMirrored = false; // Track if we disabled mirroring so we can restore it

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
}

/**
 * Detect available monitors and identify the best one for presenting.
 * Returns null if only one monitor is available.
 */
export async function detectProjector(): Promise<MonitorInfo | null> {
  try {
    const monitors = await availableMonitors();
    console.log(`[multi-monitor] Found ${monitors.length} monitor(s):`);
    for (const m of monitors) {
      console.log(`  - "${m.name}" ${m.size.width}x${m.size.height} at (${m.position.x}, ${m.position.y}) scale=${m.scaleFactor}`);
    }
    if (monitors.length <= 1) {
      console.log('[multi-monitor] Only one monitor, using single-window mode');
      return null;
    }

    const primary = await currentMonitor();
    const primaryName = primary?.name || '';
    console.log(`[multi-monitor] Primary monitor: "${primaryName}"`);

    // Find the non-primary monitor — prefer one with "projector" or "external" in name
    for (const m of monitors) {
      console.log(`[multi-monitor] Checking "${m.name}" vs primary "${primaryName}"`);
      if (m.name !== primaryName) {
        const nameLower = (m.name || '').toLowerCase();
        if (nameLower.includes('projector') || nameLower.includes('external')) {
          console.log(`[multi-monitor] Found projector: "${m.name}"`);
          return {
            name: m.name || 'External',
            width: m.size.width,
            height: m.size.height,
            x: m.position.x,
            y: m.position.y,
            scaleFactor: m.scaleFactor,
            isPrimary: false,
          };
        }
      }
    }

    // Fall back to any non-primary monitor
    for (const m of monitors) {
      if (m.name !== primaryName) {
        console.log(`[multi-monitor] Using non-primary: "${m.name}"`);
        return {
          name: m.name || 'External',
          width: m.size.width,
          height: m.size.height,
          x: m.position.x,
          y: m.position.y,
          scaleFactor: m.scaleFactor,
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
  projectPath: string | null,
  opts?: { windowed?: boolean }
): Promise<boolean> {
  // WINDOWED MODE (screen-share presentation): open the presenter as a normal,
  // chromeless, non-fullscreen window on the CURRENT monitor — so it can be
  // shared as a single window over Zoom/Meet without going fullscreen and taking
  // over the whole display. The main window keeps the speaker view. Skips mirror
  // handling, projector detection, and the above-the-menubar fullscreen that the
  // real dual-monitor path uses.
  const windowed = !!opts?.windowed;

  // Check if displays are mirrored — if so, disable mirroring first
  if (!windowed) try {
    const mirrorInfo = await invoke<{ isMirrored: boolean; displayCount: number }>('check_display_mirroring');
    console.log('[multi-monitor] Mirror info:', mirrorInfo);

    if (mirrorInfo.isMirrored) {
      console.log('[multi-monitor] Displays are mirrored, disabling mirroring...');
      const disabled = await invoke<boolean>('disable_display_mirroring');
      if (disabled) {
        wasMirrored = true;
        console.log('[multi-monitor] Mirroring disabled, waiting for displays to reconfigure...');
        // Wait for macOS to reconfigure displays
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (e) {
    console.warn('[multi-monitor] Mirror check failed:', e);
  }

  const projector = windowed ? null : await detectProjector();

  if (!windowed && !projector) {
    // If we disabled mirroring but still can't find a second monitor, re-enable
    if (wasMirrored) {
      try { await invoke('enable_display_mirroring'); wasMirrored = false; } catch { /* ignore */ }
    }
    return false; // Single monitor — caller should use in-window presenter
  }

  try {
    // Close existing presenter window if any
    await closePresenterWindow();

    if (windowed) {
      // Size the window to the slide's aspect ratio so the shared window shows
      // the slide edge-to-edge with no letterboxing. Chromeless (decorations:
      // false) so what you share over Zoom is just the slide — no title bar.
      const aw = presentation.config.width || 1280;
      const ah = presentation.config.height || 720;
      const winW = 1280;
      const winH = Math.round(winW * (ah / aw));
      console.log(`[multi-monitor] SCREEN-SHARE MODE — windowed chromeless presenter ${winW}x${winH} on the current monitor`);
      presenterWindow = new WebviewWindow('presenter', {
        url: '/presenter.html',
        // Title shows in the OS/Zoom "share a window" picker — keep it findable.
        title: 'Eigendeck Presentation',
        x: 120, y: 120, width: winW, height: winH,
        // Not fullscreen, no chrome, not pinned on top (so Zoom's share toolbar
        // stays reachable); focus it so it's visible to grab for sharing.
        fullscreen: false, decorations: false, alwaysOnTop: false, focus: true,
      });
    } else {
      // Create presenter window on the secondary monitor
      // Tauri window position uses logical pixels; monitor API returns physical pixels
      const s = projector!.scaleFactor || 1;
      const logX = Math.round(projector!.x / s);
      const logY = Math.round(projector!.y / s);
      const logW = Math.round(projector!.width / s);
      const logH = Math.round(projector!.height / s);
      console.log(`[multi-monitor] Opening presenter on "${projector!.name}" physical=(${projector!.x}, ${projector!.y}) ${projector!.width}x${projector!.height} scale=${s} logical=(${logX}, ${logY}) ${logW}x${logH}`);
      presenterWindow = new WebviewWindow('presenter', {
        url: '/presenter.html',
        title: 'Eigendeck Presenter',
        x: logX,
        y: logY,
        width: logW,
        height: logH,
        fullscreen: false, // Position first, fullscreen after
        decorations: false,
        alwaysOnTop: true,
        focus: false,
      });
    }

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

    // Set window level above the menu bar so it covers the secondary monitor fully.
    // This is how Keynote/PowerPoint do it — no fullscreen API, just a high window level.
    // Skipped for the windowed screen-share presenter (it's a normal window).
    if (!windowed) {
      console.log('[multi-monitor] Window ready, setting window level above menu bar');
      try {
        await invoke('set_window_above_menubar', { label: 'presenter' });
      } catch (e) {
        console.warn('[multi-monitor] Could not set window level:', e);
      }
    }

    // Send presentation data. `windowed` tells the projector webview it's the
    // chromeless screen-share window, so it can show a drag handle (a chromeless
    // window has no title bar to grab).
    await emitTo('presenter', 'presenter:init', {
      presentation,
      currentIndex,
      projectPath,
      windowed,
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

/** Does this monitor's (physical) bounds contain the given physical point? */
function monitorContains(mon: Monitor, x: number, y: number): boolean {
  return x >= mon.position.x && x < mon.position.x + mon.size.width &&
         y >= mon.position.y && y < mon.position.y + mon.size.height;
}

/**
 * Swap which physical display shows the live slides vs the speaker view
 * (Keynote-style "Swap Displays"). Moves the projector (live) window onto the
 * monitor the main/speaker window is on, and the main window onto the monitor
 * the projector was on; re-asserts the projector's above-the-menubar level on
 * its new display. No-op unless the dual-monitor projector window is open and
 * there are at least two monitors.
 *
 * Everything is done in PHYSICAL coordinates (monitor.position/size and
 * window.outerPosition are physical) — no logical/scale conversion, which is
 * where cross-display moves usually go wrong. Monitors are matched by GEOMETRY,
 * not by name (names are often empty or duplicated on real hardware).
 */
export async function swapPresenterDisplay(): Promise<void> {
  if (!presenterWindow) { console.warn('[multi-monitor] swap: no presenter window open'); return; }
  try {
    const monitors = await availableMonitors();
    if (monitors.length < 2) { console.warn('[multi-monitor] swap: need 2+ monitors, have', monitors.length); return; }

    const mainWin = getCurrentWindow();
    const mainPos = await mainWin.outerPosition(); // physical, top-left of main window
    const mainMon = monitors.find((m) => monitorContains(m, mainPos.x, mainPos.y)) || monitors[0];
    const otherMon = monitors.find((m) => m !== mainMon);
    if (!otherMon) { console.warn('[multi-monitor] swap: could not find a second monitor'); return; }

    console.log('[multi-monitor] swap: speaker is on', mainMon.name, `(${mainMon.position.x},${mainMon.position.y})`,
      '-> moving slides here, speaker to', otherMon.name, `(${otherMon.position.x},${otherMon.position.y})`);

    // Move the main (speaker) window onto the other display.
    await mainWin.setPosition(new PhysicalPosition(otherMon.position.x, otherMon.position.y));
    // Move + size the projector window onto the (now vacated) main display.
    await presenterWindow.setPosition(new PhysicalPosition(mainMon.position.x, mainMon.position.y));
    await presenterWindow.setSize(new PhysicalSize(mainMon.size.width, mainMon.size.height));
    // Re-assert the above-the-menubar level so it covers the new display fully.
    try { await invoke('set_window_above_menubar', { label: 'presenter' }); } catch { /* best effort */ }
    console.log('[multi-monitor] swap: done');
  } catch (e) {
    console.error('[multi-monitor] swap displays failed:', e);
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

  // Restore mirroring if we disabled it
  if (wasMirrored) {
    console.log('[multi-monitor] Restoring display mirroring...');
    try {
      await invoke('enable_display_mirroring');
      wasMirrored = false;
    } catch (e) {
      console.warn('[multi-monitor] Failed to restore mirroring:', e);
    }
  }
}

/**
 * Check if a presenter window is currently open.
 */
export function isPresenterOpen(): boolean {
  return presenterWindow !== null;
}
