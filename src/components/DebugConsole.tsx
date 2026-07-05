import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  time: string;
}

const globalLogs: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let intercepted = false;

// Continuously append every log entry to a file on disk so a crash /
// white-screen doesn't lose the captured timings. Buffered + flushed
// every ~250ms to keep the per-entry overhead negligible. Off by
// default — flip true to capture every console.log to
// ~/Library/Logs/<bundle_id>/debug.log for post-mortem analysis.
// (Leaving on in release fills the log forever; there's no rotation.)
const AUTO_WRITE = false;
const pendingWrite: LogEntry[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (!AUTO_WRITE || writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    if (pendingWrite.length === 0) return;
    const batch = pendingWrite.splice(0, pendingWrite.length);
    const text = batch.map((e) => `${e.time}\t${e.level}\t${e.message}`).join('\n') + '\n';
    try {
      // Lazy-import so this module doesn't depend on Tauri at JS-only test time.
      // appLogDir() (core path API — not the fs plugin) resolves to
      // ~/Library/Logs/<identifier>/ on macOS, %LOCALAPPDATA%\<identifier>\logs on
      // Windows, $XDG_DATA_HOME/<identifier>/logs on Linux — the platform log home.
      // `cat ~/Library/Logs/com.dgleich.eigendeck/debug.log` on Mac after a crash.
      // mkdir(recursive) is a no-op if the dir exists; first run needs it so the
      // append write doesn't fail with ENOENT.
      const { appLogDir, join } = await import('@tauri-apps/api/path');
      const { mkdirNative, writeTextFileNative } = await import('../lib/nativeFs');
      const dir = await appLogDir();
      await mkdirNative(dir).catch(() => {});
      await writeTextFileNative(await join(dir, 'debug.log'), text, { append: true });
    } catch {
      // Best-effort: if writing fails (non-Tauri context, perms), drop
      // the batch silently. Re-trying would just back up the queue.
    }
  }, 250);
}

// Stress tests (e.g. opening the PDF stress-test deck with 55 PDFs)
// emit hundreds of [render] / [pdfjs] / [pdf] lines per session. 300
// was too tight — earliest entries dropped before the test finished.
// 5000 entries is ~600KB of memory; trivial.
const MAX_LOG_ENTRIES = 5000;

function addEntry(level: LogEntry['level'], args: any[]) {
  const message = args.map((a) =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ');
  const time = new Date().toLocaleTimeString();
  const entry: LogEntry = { level, message, time };
  globalLogs.push(entry);
  if (globalLogs.length > MAX_LOG_ENTRIES) {
    globalLogs.splice(0, globalLogs.length - MAX_LOG_ENTRIES);
  }
  if (AUTO_WRITE) {
    pendingWrite.push(entry);
    scheduleFlush();
  }
  listeners.forEach((fn) => fn());
}

function interceptConsole() {
  if (intercepted) return;
  intercepted = true;
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => { origLog.apply(console, args); addEntry('log', args); };
  console.warn = (...args) => { origWarn.apply(console, args); addEntry('warn', args); };
  console.error = (...args) => { origError.apply(console, args); addEntry('error', args); };
  window.addEventListener('error', (e) => addEntry('error', [`Unhandled: ${e.message} at ${e.filename}:${e.lineno}`]));
  window.addEventListener('unhandledrejection', (e) => addEntry('error', [`Unhandled rejection: ${e.reason}`]));
}

interceptConsole();

export function DebugConsole() {
  const [visible, setVisible] = useState(false);
  const [, setTick] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setTick((t) => t + 1);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    const handleCustom = () => setVisible((v) => !v);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('toggle-debug-console', handleCustom);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('toggle-debug-console', handleCustom);
    };
  }, []);

  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [globalLogs.length, visible]);

  if (!visible) return null;

  return (
    <div className="debug-console">
      <div className="debug-header">
        <span>Debug Console ({globalLogs.length})</span>
        <div>
          <button
            title="Copy all log lines to the clipboard"
            onClick={async () => {
              const text = globalLogs
                .map((e) => `${e.time}\t${e.level}\t${e.message}`)
                .join('\n');
              // Try the Clipboard API first. Tauri's webview accepts it but
              // it's silent-fail-prone — confirm via a tiny re-read.
              let copied = false;
              try {
                await navigator.clipboard.writeText(text);
                copied = true;
              } catch {/* will fall through */}
              if (!copied) {
                // Fallback: invisible textarea + execCommand. Old API but
                // always works in a webview, no permissions needed.
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); copied = true; } catch {/* ignore */}
                document.body.removeChild(ta);
              }
              if (!copied) console.warn('Copy failed; use Save… instead.');
            }}
          >Copy</button>
          <button
            title="Write the log to a file on disk (survives an app crash)"
            onClick={async () => {
              const text = globalLogs
                .map((e) => `${e.time}\t${e.level}\t${e.message}`)
                .join('\n');
              try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { writeTextFileNative } = await import('../lib/nativeFs');
                const defaultName = `eigendeck-log-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
                const path = await save({ defaultPath: defaultName, filters: [{ name: 'Text', extensions: ['txt', 'log'] }] });
                if (!path) return;  // user cancelled
                await writeTextFileNative(path as string, text);
              } catch (e) {
                console.error('Save log failed:', e);
                alert(`Save log failed: ${e}`);
              }
            }}
          >Save…</button>
          <button onClick={() => { globalLogs.length = 0; setTick((t) => t + 1); }}>Clear</button>
          <button onClick={() => setVisible(false)}>×</button>
        </div>
      </div>
      <div className="debug-logs">
        {globalLogs.map((entry, i) => (
          <div key={i} className={`debug-entry debug-${entry.level}`}>
            <span className="debug-time">{entry.time}</span>
            <span className="debug-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
