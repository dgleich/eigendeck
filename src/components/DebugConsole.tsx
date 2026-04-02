import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  time: string;
}

/**
 * Debug console panel — captures console.log/warn/error and unhandled errors.
 * Toggle with Cmd+Shift+D or View > Debug Console.
 */
export function DebugConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [visible, setVisible] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const addEntry = (level: LogEntry['level'], args: any[]) => {
      const message = args.map((a) =>
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ');
      const time = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-200), { level, message, time }]);
    };

    console.log = (...args) => { origLog.apply(console, args); addEntry('log', args); };
    console.warn = (...args) => { origWarn.apply(console, args); addEntry('warn', args); };
    console.error = (...args) => { origError.apply(console, args); addEntry('error', args); };

    const handleError = (e: ErrorEvent) => {
      addEntry('error', [`Unhandled: ${e.message} at ${e.filename}:${e.lineno}`]);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      addEntry('error', [`Unhandled rejection: ${e.reason}`]);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    // Toggle with Cmd+Shift+D
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!visible) return null;

  return (
    <div className="debug-console">
      <div className="debug-header">
        <span>Debug Console ({logs.length})</span>
        <div>
          <button onClick={() => setLogs([])}>Clear</button>
          <button onClick={() => setVisible(false)}>×</button>
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
