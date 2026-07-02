// Native confirm dialog, with a dev/test stand-in for the one thing WebDriver can't
// drive: an OS dialog (see e2e seam-discipline; the same rationale as filePicker.ts).
// In dev or seam builds ONLY, a probe may preset the next answer via
// `window.__eigendeckConfirm` so it can drive a control that guards on a native
// confirm (e.g. "Stop trusting this deck"). In production this is a thin wrapper
// over the native dialog.
interface ConfirmOptions {
  title?: string;
  kind?: 'info' | 'warning' | 'error';
  okLabel?: string;
  cancelLabel?: string;
}

export async function askConfirm(message: string, opts?: ConfirmOptions): Promise<boolean> {
  if (import.meta.env.DEV || import.meta.env.VITE_EIGENDECK_SEAM === '1') {
    const w = window as unknown as { __eigendeckConfirm?: boolean };
    if (typeof w.__eigendeckConfirm === 'boolean') {
      const answer = w.__eigendeckConfirm;
      delete w.__eigendeckConfirm;   // one-shot, mirrors a single dialog interaction
      return answer;
    }
  }
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, opts);
}
