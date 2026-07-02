// Native file-open picker, with a dev/test stand-in for the ONE thing WebDriver
// genuinely cannot drive: the OS file dialog (see the e2e seam-discipline note —
// system Open/Save/picker dialogs are the only sanctioned bypass). In dev or seam
// builds ONLY, a probe may preset the next pick via `window.__eigendeckPickFile`,
// letting it exercise the REAL flow behind a control (e.g. AssetSection's
// "Relocate…") — the actual app logic still runs; only the dialog is stubbed.
// In production this is a thin wrapper over the native dialog.
import type { OpenDialogOptions } from '@tauri-apps/plugin-dialog';

export async function pickFile(opts: OpenDialogOptions): Promise<string | null> {
  if (import.meta.env.DEV || import.meta.env.VITE_EIGENDECK_SEAM === '1') {
    const w = window as unknown as { __eigendeckPickFile?: string };
    if (w.__eigendeckPickFile) {
      const picked = w.__eigendeckPickFile;
      delete w.__eigendeckPickFile;   // one-shot, mirrors a single dialog interaction
      return picked;
    }
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open(opts);
  return typeof picked === 'string' ? picked : null;
}
