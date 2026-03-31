import { useEffect, useRef } from 'react';
import Reveal from 'reveal.js';
import RevealNotes from 'reveal.js/plugin/notes/notes.esm.js';
import 'reveal.js/dist/reveal.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

// We load the theme CSS dynamically based on the user's selection
// instead of importing white.css statically (which bleeds into the app)

// Override reveal.js theme styles to match our editor exactly
const SLIDE_OVERRIDE_CSS = `
  .reveal {
    font-family: 'PT Sans', sans-serif;
    font-size: 32px;
    font-weight: normal;
    line-height: 1.4;
    color: #222;
  }
  .reveal .slides {
    text-align: left;
  }
  .reveal h1 {
    font-family: 'PT Sans', sans-serif;
    font-size: 56px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 24px;
    color: #222;
    text-transform: none;
    text-shadow: none;
  }
  .reveal h2 {
    font-family: 'PT Sans', sans-serif;
    font-size: 44px;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 20px;
    color: #222;
    text-transform: none;
    text-shadow: none;
  }
  .reveal h3 {
    font-family: 'PT Sans', sans-serif;
    font-size: 36px;
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
    padding: 60px 80px;
  }
`;

export function PresentMode() {
  const { presentation, setPresenting, projectPath } = usePresentationStore();
  const deckRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealRef = useRef<any>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const themeRef = useRef<HTMLLinkElement | null>(null);

  useEffect(() => {
    if (!deckRef.current) return;

    // Load reveal.js theme CSS dynamically
    const themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.href = new URL(
      `../../node_modules/reveal.js/dist/theme/${presentation.theme}.css`,
      import.meta.url
    ).href;
    document.head.appendChild(themeLink);
    themeRef.current = themeLink;

    // Inject override styles (after theme so they take precedence)
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
      if (themeRef.current) {
        document.head.removeChild(themeRef.current);
        themeRef.current = null;
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

    if (slide.content.image && projectPath) {
      const pos = slide.content.imagePosition || {
        x: 100,
        y: 150,
        width: 700,
        height: 450,
      };
      const imgSrc = convertFileSrc(`${projectPath}/${slide.content.image}`);
      html += `<img src="${imgSrc}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;object-fit:contain;" />`;
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
