import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * This test ensures LLM-EDITING.md stays in sync with the actual types.
 * It checks that key fields and types mentioned in the code are documented.
 */
describe('LLM-EDITING.md sync', () => {
  const typesSource = readFileSync(resolve(__dirname, '../../src/types/presentation.ts'), 'utf-8');
  const llmDoc = readFileSync(resolve(__dirname, '../../LLM-EDITING.md'), 'utf-8');

  it('documents all element type interfaces', () => {
    // Check each element type is mentioned
    for (const t of ['TextElement', 'ImageElement', 'ArrowElement', 'DemoElement']) {
      const typeName = t.replace('Element', '').toLowerCase();
      expect(llmDoc.toLowerCase()).toContain(`${typeName} element`);
    }
  });

  it('documents all TextPreset values', () => {
    const presetMatch = typesSource.match(/type TextPreset\s*=\s*([^;]+)/);
    if (presetMatch) {
      const presets = presetMatch[1].match(/'(\w+)'/g)?.map((s: string) => s.replace(/'/g, '')) || [];
      for (const preset of presets) {
        expect(llmDoc).toContain(preset);
      }
    }
  });

  it('documents key BaseElement fields', () => {
    // Extract field names from BaseElement interface
    const baseMatch = typesSource.match(/interface BaseElement\s*\{([^}]+)\}/);
    if (baseMatch) {
      const fields = baseMatch[1].match(/(\w+)\??:/g)?.map((s: string) => s.replace(/\??:/, '')) || [];
      for (const field of fields) {
        expect(llmDoc).toContain(field);
      }
    }
  });

  it('documents PresentationConfig fields', () => {
    const configMatch = typesSource.match(/interface PresentationConfig\s*\{([^}]+)\}/);
    if (configMatch) {
      const fields = configMatch[1].match(/(\w+)\??:/g)?.map((s: string) => s.replace(/\??:/, '')) || [];
      for (const field of fields) {
        expect(llmDoc).toContain(field);
      }
    }
  });

  it('documents TextElement-specific fields', () => {
    // Check that verticalAlign is documented
    if (typesSource.includes('verticalAlign')) {
      expect(llmDoc).toContain('verticalAlign');
    }
  });

  it('documents Slide fields', () => {
    const slideMatch = typesSource.match(/interface Slide\s*\{([^}]+)\}/);
    if (slideMatch) {
      const fields = slideMatch[1].match(/(\w+)\??:/g)?.map((s: string) => s.replace(/\??:/, '')) || [];
      for (const field of fields) {
        expect(llmDoc).toContain(field);
      }
    }
  });

  it('has correct default title position', () => {
    const titleMatch = typesSource.match(/title:\s*\{[^}]*y:\s*(\d+)[^}]*height:\s*(\d+)/);
    if (titleMatch) {
      expect(llmDoc).toContain(`y: ${titleMatch[1]}`);
    }
  });
});
