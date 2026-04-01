export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DemoPosition = ElementPosition;
export type ImagePosition = ElementPosition;

export type SlideLayout = 'default' | 'centered' | 'two-column';

export interface TextBox {
  id: string;
  html: string;
  position: ElementPosition;
}

export interface Arrow {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  strokeWidth?: number;
  headSize?: number;
}

export interface SlideContent {
  html: string;
  demo?: string;
  demoPosition?: DemoPosition;
  image?: string;
  imagePosition?: ImagePosition;
  textBoxes?: TextBox[];
  arrows?: Arrow[];
}

export interface Slide {
  id: string;
  type: 'text' | 'mixed' | 'image';
  layout?: SlideLayout;
  content: SlideContent;
  notes: string;
}

export interface PresentationConfig {
  transition: string;
  backgroundTransition: string;
  width: number;
  height: number;
  showSlideNumber?: boolean;
}

export interface Presentation {
  title: string;
  theme: string;
  slides: Slide[];
  config: PresentationConfig;
}

export function createDefaultPresentation(): Presentation {
  return {
    title: 'Untitled Presentation',
    theme: 'white',
    slides: [
      {
        id: crypto.randomUUID(),
        type: 'text',
        layout: 'centered',
        content: { html: '<h1>Untitled Presentation</h1>' },
        notes: '',
      },
    ],
    config: {
      transition: 'slide',
      backgroundTransition: 'fade',
      width: 1920,
      height: 1080,
      showSlideNumber: true,
    },
  };
}

export function createBlankSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    layout: 'default',
    content: { html: '<h2>New Slide</h2>' },
    notes: '',
  };
}
