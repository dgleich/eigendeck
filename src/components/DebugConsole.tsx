import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  time: string;
}

// Global log store so entries persist across mount/unmount
const globalLogs: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let intercepted = false;

function addEntry(level: LogEntry['level'], args: any[]) {
  const message = args.map((a) =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ');
  const time = new Date().toLocaleTimeString();
  globalLogs.push({ level, message, time });
  if (globalLogs.length > 300) globalLogs.splice(0, globalLogs.length - 300);
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

// Start intercepting immediately
interceptConsole();

/**
 * Debug console — renders in a separate popup window.
 * Toggle with Cmd+Shift+D or View > Debug Console.
 */
export function DebugConsole() {
  const [visible, setVisible] = useState(false);
  const [, setTick] = useState(0);
  const popupRef = useRef<Window | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Listen for log updates
  useEffect(() => {
    const update = () => setTick((t) => t + 1);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  // Keyboard + menu toggle
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

  // Open/close popup window
  useEffect(() => {
    if (visible && !popupRef.current) {
      const popup = window.open('', 'eigendeck-debug', 'width=700,height=400,menubar=no,toolbar=no');
      if (popup) {
        popupRef.current = popup;
        popup.document.title = 'Eigendeck Debug Console';
        popup.document.body.style.cssText = 'margin:0;background:#1a1a2e;color:#eee;font-family:SF Mono,Menlo,Monaco,monospace;font-size:12px;';
        const container = popup.document.createElement('div');
        container.id = 'debug-root';
        popup.document.body.appendChild(container);
        containerRef.current = container;

        popup.addEventListener('beforeunload', () => {
          popupRef.current = null;
          containerRef.current = null;
          setVisible(false);
        });
      } else {
        // Popup blocked — fall back to inline
        console.warn('Debug console popup blocked, using inline panel');
      }
    }

    if (!visible && popupRef.current) {
      popupRef.current.close();
      popupRef.current = null;
      containerRef.current = null;
    }
  }, [visible]);

  // Render logs into popup
  useEffect(() => {
    if (!popupRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const colors = { log: '#ccc', warn: '#fbbf24', error: '#f87171' };

    container.innerHTML = globalLogs.map((entry) =>
      `<div style="padding:2px 10px;border-bottom:1px solid #222;display:flex;gap:8px;">` +
      `<span style="color:#666;flex-shrink:0;">${entry.time}</span>` +
      `<span style="color:${colors[entry.level]};white-space:pre-wrap;word-break:break-all;">${
        entry.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }</span></div>`
    ).join('');

    container.scrollTop = container.scrollHeight;
  });

  // If popup was blocked, fall back to inline panel
  if (visible && !popupRef.current && !containerRef.current) {
    return <InlineDebugPanel logs={globalLogs} onClose={() => setVisible(false)} />;
  }

  return null;
}

function InlineDebugPanel({ logs, onClose }: { logs: LogEntry[]; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="debug-console">
      <div className="debug-header">
        <span>Debug Console ({logs.length})</span>
        <div>
          <button onClick={() => { globalLogs.length = 0; }}>Clear</button>
          <button onClick={onClose}>×</button>
        </div>
      </div>
      <div className="debug-logs">
        {logs.map((entry, i) => (
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
