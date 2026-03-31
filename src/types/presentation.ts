export interface DemoPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideContent {
  html: string;
  demo?: string;
  demoPosition?: DemoPosition;
  image?: string;
  imagePosition?: ImagePosition;
}

export interface Slide {
  id: string;
  type: 'text' | 'mixed' | 'image';
  content: SlideContent;
  notes: string;
}

export interface PresentationConfig {
  transition: string;
  backgroundTransition: string;
  width: number;
  height: number;
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
        content: { html: '<h1>Untitled Presentation</h1>' },
        notes: '',
      },
    ],
    config: {
      transition: 'slide',
      backgroundTransition: 'fade',
      width: 960,
      height: 700,
    },
  };
}

export function createBlankSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    content: { html: '<h2>New Slide</h2>' },
    notes: '',
  };
}
