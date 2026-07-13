export type VarType = 'float' | 'int' | 'color' | 'string';

export interface VarSpec {
  name: string;
  type: VarType;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  help?: string;
  /** Inspector control width in px (author hint). */
  width?: number;
  /** `string` only: render a multi-line textarea instead of a single-line box. */
  multiline?: boolean;
}

export const VARS_SCRIPT_TYPE: string;
export const VAR_TYPES: VarType[];
export const TINT_PREFIX: string;

export function isValidColor(v: unknown): boolean;
export function tintBase(v: unknown): string;
export function isTintToken(v: unknown): boolean;
export function isColorValue(v: unknown): boolean;
export function parseHtmlVars(html: string | null | undefined): VarSpec[];
export function validateVarValue(
  spec: VarSpec,
  raw: unknown,
): { ok: boolean; value?: number | string };
export function resolveVars(
  specs: VarSpec[],
  vars: Record<string, number | string> | undefined,
): Record<string, number | string>;
export function stripVarsManifest(html: string): string;
