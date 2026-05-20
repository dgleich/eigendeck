// Shared report shapes for the Debug menu's batch operations. All reports
// are designed to serialize cleanly to JSON for offline inspection.

export interface RunMeta {
  /** Which batch action produced this report */
  action: 'batch-html-export' | 'batch-roundtrip' | 'batch-cache-audit';
  /** ISO 8601 timestamp */
  startedAt: string;
  /** Directory the user picked */
  directory: string;
  /** Number of .eigendeck files found */
  totalFiles: number;
  /** Total wall-clock seconds */
  elapsedSeconds: number;
  /** Aggregate pass count */
  passed: number;
  /** Aggregate fail count */
  failed: number;
}

// ---- batch HTML export ----

export interface ExportFileReport {
  input: string;
  output: string;
  ok: boolean;
  error?: string;
  /** Number of <svg role="img"> blocks in the output (pre-rendered math) */
  mathSvgs: number;
  /** Distinct font-family names embedded */
  fontFamilies: string[];
  /** Should always be 0 — non-zero means a CDN leak slipped in */
  cdnLeaks: number;
  /** Distinct math bundles used (cascade output) */
  bundlesUsed: string[];
  /** Output html size in bytes */
  sizeBytes: number;
  elapsedMs: number;
}

export interface ExportReport {
  meta: RunMeta;
  files: ExportFileReport[];
}

// ---- batch round-trip ----

export interface RoundtripFileReport {
  input: string;
  ok: boolean;
  error?: string;
  /** Number of slides in the source */
  slideCount: number;
  /** Number of slides with per-slide config overrides */
  slidesWithConfig: number;
  /** Total elements in the source */
  elementCount: number;
  /** A short list of fields that differ between before/after JSON (path:value) */
  diffs: string[];
  elapsedMs: number;
}

export interface RoundtripReport {
  meta: RunMeta;
  files: RoundtripFileReport[];
}

// ---- batch math cache audit ----

export interface CacheMiss {
  preset: string;
  bundle: string;
  display: boolean;
  /** Truncated tex preview */
  tex: string;
}

export interface CacheAuditFileReport {
  input: string;
  ok: boolean;
  error?: string;
  /** Total $..$ and $$..$$ expressions found across all text elements */
  expressionsFound: number;
  /** Cached rows present in the file */
  cacheRows: number;
  /** Expressions resolved from cache */
  hits: number;
  /** Expressions NOT in cache (open + ⌘S to seed) */
  misses: number;
  /** Per-bundle hit/miss breakdown */
  perBundle: Record<string, { hits: number; misses: number }>;
  /** Up to 10 sample misses for debugging */
  sampleMisses: CacheMiss[];
  elapsedMs: number;
}

export interface CacheAuditReport {
  meta: RunMeta;
  files: CacheAuditFileReport[];
}
