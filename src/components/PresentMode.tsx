import { useEffect, useRef } from 'react';
import Reveal from 'reveal.js';
import RevealNotes from 'reveal.js/plugin/notes/notes.esm.js';
import 'reveal.js/dist/reveal.css';
import 'reveal.js/dist/theme/white.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

// Override reveal.js theme styles to match our editor exactly
const SLIDE_OVERRIDE_CSS = `
  .reveal {
    font-family: 'PT Sans', sans-serif;
    font-size: 42px;
    font-weight: normal;
    line-height: 1.3;
    color: #222;
  }
  .reveal h1 {
    font-family: 'PT Sans', sans-serif;
    font-size: 72px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 24px;
    color: #222;
    text-transform: none;
    text-shadow: none;
  }
  .reveal h2 {
    font-family: 'PT Sans', sans-serif;
    font-size: 56px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 20px;
    color: #222;
    text-transform: none;
    text-shadow: none;
  }
  .reveal h3 {
    font-family: 'PT Sans', sans-serif;
    font-size: 44px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 16px;
    color: #222;
    text-transform: none;
    text-shadow: none;
  }
  .reveal p {
    margin-bottom: 16px;
  }
  .reveal ul, .reveal ol {
    padding-left: 1.2em;
    margin-bottom: 16px;
  }
  .reveal li {
    margin-bottom: 8px;
  }
  .reveal section {
    text-align: left;
    padding: 40px 60px;
  }
`;

export function PresentMode() {
  const { presentation, setPresenting, projectPath } = usePresentationStore();
  const deckRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealRef = useRef<any>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!deckRef.current) return;

    // Inject override styles
    const style = document.createElement('style');
    style.textContent = SLIDE_OVERRIDE_CSS;
    document.head.appendChild(style);
    styleRef.current = style;

    const deck = new Reveal(deckRef.current, {
      hash: false,
      transition: presentation.config.transition as any,
      backgroundTransition: presentation.config.backgroundTransition as any,
      width: presentation.config.width,
      height: presentation.config.height,
      embedded: false,
      center: false,
      plugins: [RevealNotes],
    });

    deck.initialize().then(() => {
      revealRef.current = deck;
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPresenting(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (revealRef.current) {
        revealRef.current.destroy();
        revealRef.current = null;
      }
      if (styleRef.current) {
        document.head.removeChild(styleRef.current);
        styleRef.current = null;
      }
    };
  }, []);

  const buildSlideHtml = (slide: (typeof presentation.slides)[0]) => {
    let html = slide.content.html || '';

    if (slide.content.demo && projectPath) {
      const pos = slide.content.demoPosition || {
        x: 0,
        y: 200,
        width: 800,
        height: 400,
      };
      const demoSrc = convertFileSrc(`${projectPath}/${slide.content.demo}`);
      html += `<iframe src="${demoSrc}" sandbox="allow-scripts allow-same-origin" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;border:none;"></iframe>`;
    }

    if (slide.notes) {
      html += `<aside class="notes">${slide.notes}</aside>`;
    }

    return html;
  };

  return (
    <div className="present-mode">
      <div className="reveal" ref={deckRef}>
        <div className="slides">
          {presentation.slides.map((slide) => (
            <section
              key={slide.id}
              dangerouslySetInnerHTML={{ __html: buildSlideHtml(slide) }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
