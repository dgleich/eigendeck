import { useEffect, useRef } from 'react';
import Reveal from 'reveal.js';
import 'reveal.js/dist/reveal.css';
import 'reveal.js/dist/theme/white.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';

export function PresentMode() {
  const { presentation, setPresenting, projectPath } = usePresentationStore();
  const deckRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealRef = useRef<any>(null);

  useEffect(() => {
    if (!deckRef.current) return;

    const deck = new Reveal(deckRef.current, {
      hash: false,
      transition: presentation.config.transition as any,
      backgroundTransition: presentation.config.backgroundTransition as any,
      width: presentation.config.width,
      height: presentation.config.height,
      embedded: false,
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
        <div className="slides" style={{ fontFamily: "'PT Sans', sans-serif" }}>
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
