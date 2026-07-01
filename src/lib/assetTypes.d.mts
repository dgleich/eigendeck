// Type declarations for assetTypes.mjs (see the .mjs/.d.mts convention in src/lib).

export type AssetKind = 'image' | 'pdf' | 'video' | 'notebook' | 'demo' | 'captions';
export type GateReason = 'bad-extension' | 'content-mismatch' | 'unsupported-demo-version';
export type Bytes = Uint8Array | ArrayBuffer | string;

export const ASSET_EXTENSIONS: Readonly<Record<string, AssetKind>>;
export const DEMO_MARKER_PREFIX: string;
export const SUPPORTED_DEMO_VERSIONS: ReadonlySet<number>;
export const NOTEBOOK_MAX_BYTES: number;

export function extensionOf(path: string): string;
export function assetKindForPath(path: string): AssetKind | null;
export function isAllowedExtension(path: string): boolean;

export function isEigendeckDemo(input: Bytes): { ok: boolean; version: number | null; supported: boolean };
export function checkContent(input: Bytes, ext: string): { ok: boolean; reason: GateReason | null };
export function contentMatchesExtension(input: Bytes, ext: string): boolean;
export function assetTypeGate(input: Bytes, resolvedRealPath: string): { ok: boolean; kind: AssetKind | null; reason: GateReason | null };
