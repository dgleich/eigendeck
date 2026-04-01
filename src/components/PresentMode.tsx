import { useEffect, useRef, useState } from 'react';
import Reveal from 'reveal.js';
import 'reveal.js/dist/reveal.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { SpeakerPanel } from './SpeakerView';
import { THEME_CSS } from './revealThemes';

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
    position: relative;
    box-sizing: border-box;
  }
  .reveal section img.slide-image {
    position: absolute;
    object-fit: contain;
  }
  .reveal section[data-layout="centered"] {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  .reveal section[data-layout="two-column"] {
    column-count: 2;
    column-gap: 80px;
  }
  .reveal .slide-number {
    font-family: 'PT Sans', sans-serif;
    font-size: 24px;
    color: #999;
  }
`;

export function PresentMode() {
  const { presentation, setPresenting, selectSlide, projectPath } =
    usePresentationStore();
  const deckRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealRef = useRef<any>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const themeStyleRef = useRef<HTMLStyleElement | null>(null);
  const [showSpeaker, setShowSpeaker] = useState(false);

  useEffect(() => {
    if (!deckRef.current) return;

    // Inject theme CSS as a style tag (works in both dev and production)
    const themeCss = THEME_CSS[presentation.theme] || THEME_CSS.white;
    const themeStyle = document.createElement('style');
    themeStyle.textContent = themeCss;
    document.head.appendChild(themeStyle);
    themeStyleRef.current = themeStyle;

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
      slideNumber: presentation.config.showSlideNumber !== false,
    });

    deck.initialize().then(() => {
      revealRef.current = deck;
    });

    // Sync reveal.js slide changes back to our store
    const onSlideChanged = (event: any) => {
      const idx = event.indexh ?? 0;
      selectSlide(idx);
    };

    deck.on('slidechanged', onSlideChanged);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPresenting(false);
      }
      if (e.key === 's' || e.key === 'S') {
        // Don't let reveal.js handle S (it tries window.open)
        e.stopPropagation();
        setShowSpeaker((prev) => !prev);
      }
    };
    // Use capture to intercept before reveal.js
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      deck.off('slidechanged', onSlideChanged);
      if (revealRef.current) {
        revealRef.current.destroy();
        revealRef.current = null;
      }
      if (styleRef.current) {
        document.head.removeChild(styleRef.current);
        styleRef.current = null;
      }
      if (themeStyleRef.current) {
        document.head.removeChild(themeStyleRef.current);
        themeStyleRef.current = null;
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

    if (slide.content.image) {
      const pos = slide.content.imagePosition || {
        x: 360,
        y: 200,
        width: 1200,
        height: 680,
      };
      let imgSrc: string;
      if (slide.content.image.startsWith('data:')) {
        imgSrc = slide.content.image;
      } else if (projectPath) {
        imgSrc = convertFileSrc(`${projectPath}/${slide.content.image}`);
      } else {
        imgSrc = slide.content.image;
      }
      html += `<img class="slide-image" src="${imgSrc}" style="left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;" />`;
    }

    // Text boxes
    if (slide.content.textBoxes) {
      for (const box of slide.content.textBoxes) {
        const p = box.position;
        html += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:'PT Sans',sans-serif;font-size:32px;line-height:1.4;color:#222;padding:12px 16px;overflow:hidden;">${box.html}</div>`;
      }
    }

    // Arrows
    if (slide.content.arrows) {
      html += '<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">';
      for (const a of slide.content.arrows) {
        const color = a.color || '#e53e3e';
        const sw = a.strokeWidth || 4;
        const hs = a.headSize || 16;
        const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const ha = Math.PI / 6;
        const hx1 = a.x2 - hs * Math.cos(angle - ha);
        const hy1 = a.y2 - hs * Math.sin(angle - ha);
        const hx2 = a.x2 - hs * Math.cos(angle + ha);
        const hy2 = a.y2 - hs * Math.sin(angle + ha);
        html += `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${color}" stroke-width="${sw}"/>`;
        html += `<polygon points="${a.x2},${a.y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${color}"/>`;
      }
      html += '</svg>';
    }

    if (slide.notes) {
      html += `<aside class="notes">${slide.notes}</aside>`;
    }

    return html;
  };

  return (
    <div className={`present-mode ${showSpeaker ? 'with-speaker' : ''}`}>
      <div className="reveal" ref={deckRef}>
        <div className="slides">
          {presentation.slides.map((slide) => (
            <section
              key={slide.id}
              data-layout={slide.layout || 'default'}
              dangerouslySetInnerHTML={{ __html: buildSlideHtml(slide) }}
            />
          ))}
        </div>
      </div>
      {showSpeaker && <SpeakerPanel />}
    </div>
  );
}
