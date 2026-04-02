import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  time: string;
}

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
