export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SlideLayout = 'default' | 'centered' | 'two-column';

// ============================================
// Unified element types
// ============================================

interface BaseElement {
  id: string;
  position: ElementPosition;
  linkId?: string; // for cross-slide linked objects (future)
}

export interface TitleElement extends BaseElement {
  type: 'title';
  text: string;
  fontSize?: number;
}

export interface TextBoxElement extends BaseElement {
  type: 'textBox';
  html: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string; // relative path or data: URL
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
  src: string; // relative path to .html file
}

export type SlideElement =
  | TitleElement
  | TextBoxElement
  | ImageElement
  | ArrowElement
  | DemoElement;

// ============================================
// Slide and Presentation
// ============================================

export interface Slide {
  id: string;
  layout?: SlideLayout;
  bodyHtml: string; // main TipTap content
  elements: SlideElement[]; // array order = z-order (first = bottom)
  notes: string;
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

export function createDefaultPresentation(): Presentation {
  return {
    title: 'Untitled Presentation',
    theme: 'white',
    slides: [
      {
        id: crypto.randomUUID(),
        layout: 'centered',
        bodyHtml: '',
        elements: [
          {
            id: crypto.randomUUID(),
            type: 'title',
            text: 'Untitled Presentation',
            position: { x: 160, y: 360, width: 1600, height: 120 },
            fontSize: 72,
          },
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
    bodyHtml: '',
    elements: [
      {
        id: crypto.randomUUID(),
        type: 'title',
        text: 'New Slide',
        position: { x: 80, y: 40, width: 1760, height: 100 },
        fontSize: 56,
      },
    ],
    notes: '',
  };
}
