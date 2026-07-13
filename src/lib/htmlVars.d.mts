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
}

export const VARS_SCRIPT_TYPE: string;
export const VAR_TYPES: VarType[];

export function isValidColor(v: unknown): boolean;
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
