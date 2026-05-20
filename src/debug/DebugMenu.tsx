// The frontend's ONLY flag-aware surface: invoke('debug_enabled') once on
// mount, then if true subscribe to menu-event with the debug-* prefix.
// Renders nothing (headless). Mounted unconditionally from App.tsx; gates
// itself internally so App.tsx never reads the flag either.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { runBatchExportHtml } from './batchExportHtml';
import { runBatchRoundtrip } from './batchRoundtrip';
import { runBatchCacheAudit } from './batchCacheAudit';

export function DebugMenu(): null {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    invoke<boolean>('debug_enabled').then(setEnabled).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: UnlistenFn | undefined;
    listen<string>('menu-event', (event) => {
      const id = event.payload;
      if (!id.startsWith('debug-')) return;
      switch (id) {
        case 'debug-batch-html':         void runBatchExportHtml(); break;
        case 'debug-batch-roundtrip':    void runBatchRoundtrip(); break;
        case 'debug-batch-cache-audit':  void runBatchCacheAudit(); break;
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [enabled]);

  return null;
}
