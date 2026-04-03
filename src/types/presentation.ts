export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SlideLayout = 'default' | 'centered' | 'two-column';

// ============================================
// Text box presets
// ============================================

export type TextPreset = 'title' | 'body' | 'textbox' | 'annotation' | 'footnote';

export const TEXT_PRESET_STYLES: Record<TextPreset, {
  label: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
}> = {
  title: {
    label: 'Title',
    fontSize: 72,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: '700',
    fontStyle: 'normal',
    color: '#222',
  },
  body: {
    label: 'Body',
    fontSize: 48,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  textbox: {
    label: 'Text Box',
    fontSize: 48,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#222',
  },
  annotation: {
    label: 'Annotation',
    fontSize: 32,
    fontFamily: "'PT Sans', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'italic',
    color: '#2563eb',
  },
  footnote: {
    label: 'Footnote',
    fontSize: 24,
    fontFamily: "'PT Sans Narrow', sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#888',
  },
};

// ============================================
// Unified element types
// ============================================

interface BaseElement {
  id: string;
  position: ElementPosition;
  linkId?: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  preset: TextPreset;
  html: string;
  // Optional overrides (if user customizes beyond the preset)
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  strokeWidth?: number;
  headSize?: number;
}

export interface DemoElement extends BaseElement {
  type: 'demo';
  src: string;
}

export type SlideElement =
  | TextElement
  | ImageElement
  | ArrowElement
  | DemoElement;

// ============================================
// Slide and Presentation
// ============================================

export interface Slide {
  id: string;
  layout?: SlideLayout;
  elements: SlideElement[];
  notes: string;
  groupId?: string; // slides with same groupId form a group
}

export interface PresentationConfig {
  transition: string;
  backgroundTransition: string;
  width: number;
  height: number;
  showSlideNumber?: boolean;
  author?: string;
  venue?: string;
}

export interface Presentation {
  title: string;
  theme: string;
  slides: Slide[];
  config: PresentationConfig;
}

// ============================================
// Factories
// ============================================

export function createTextElement(preset: TextPreset, overrides?: Partial<ElementPosition>): TextElement {
  const defaults: Record<TextPreset, ElementPosition> = {
    title:      { x: 80,  y: 40,  width: 1760, height: 120 },
    body:       { x: 80,  y: 180, width: 1760, height: 800 },
    textbox:    { x: 200, y: 300, width: 800,  height: 300 },
    annotation: { x: 200, y: 700, width: 600,  height: 150 },
    footnote:   { x: 80,  y: 1020, width: 1000, height: 44  },
  };

  const defaultText: Record<TextPreset, string> = {
    title: 'Title',
    body: '',
    textbox: 'Text',
    annotation: 'Annotation',
    footnote: 'Footnote',
  };

  return {
    id: crypto.randomUUID(),
    type: 'text',
    preset,
    html: defaultText[preset],
    position: { ...defaults[preset], ...overrides },
  };
}

export function createDefaultPresentation(): Presentation {
  return {
    title: 'Untitled Presentation',
    theme: 'white',
    slides: [
      {
        id: crypto.randomUUID(),
        layout: 'centered',
        elements: [
          createTextElement('title', { x: 160, y: 400, width: 1600, height: 140 }),
        ],
        notes: '',
      },
    ],
    config: {
      transition: 'slide',
      backgroundTransition: 'fade',
      width: 1920,
      height: 1080,
      showSlideNumber: true,
      author: '',
      venue: '',
    },
  };
}

export function createBlankSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    layout: 'default',
    elements: [
      createTextElement('title'),
      createTextElement('body'),
    ],
    notes: '',
  };
}

// ============================================
// Slide group helpers
// ============================================

/** Get the display slide number for a given slide index (groups share a number) */
export function getSlideNumber(slides: Slide[], index: number): number {
  let num = 0;
  for (let i = 0; i <= index; i++) {
    const slide = slides[i];
    const prev = i > 0 ? slides[i - 1] : null;
    // Increment number if this slide starts a new group or has no group
    if (!slide.groupId || !prev || prev.groupId !== slide.groupId) {
      num++;
    }
  }
  return num;
}

/** Check if a slide is a child (not the first) in its group */
export function isGroupChild(slides: Slide[], index: number): boolean {
  const slide = slides[index];
  if (!slide.groupId) return false;
  if (index === 0) return false;
  return slides[index - 1].groupId === slide.groupId;
}

/** Get all slide indices in the same group */
export function getGroupIndices(slides: Slide[], index: number): number[] {
  const slide = slides[index];
  if (!slide.groupId) return [index];
  return slides.reduce<number[]>((acc, s, i) => {
    if (s.groupId === slide.groupId) acc.push(i);
    return acc;
  }, []);
}
