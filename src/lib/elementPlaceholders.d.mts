export interface PlaceholderSpec {
  label: string;
  color: string;
  bg: string;
  borderColor: string;
}
export const ELEMENT_PLACEHOLDERS: Record<'demo' | 'demo-piece' | 'notebook', PlaceholderSpec>;
