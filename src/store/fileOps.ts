import { open, save, message } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs';
import {
  Presentation,
  TEXT_PRESET_STYLES,
  createDefaultPresentation,
} from '../types/presentation';
import { usePresentationStore } from './presentation';
import { renderMathInHtml, containsMath, applyMathPreamble } from '../lib/mathjax';

async function showError(msg: string) {
  await message(msg, { title: 'Error', kind: 'error' });
}

// ============================================
// Recent projects (stored in localStorage)
// ============================================
const RECENT_KEY = 'eigendeck-recent-projects';
const MAX_RECENT = 10;

export interface RecentProject {
  path: string;
  title: string;
  lastOpened: string; // ISO timestamp
}

export function getRecentProjects(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch { return []; }
}

function addRecentProject(path: string, title: string) {
  const recents = getRecentProjects().filter((r) => r.path !== path);
  recents.unshift({ path, title, lastOpened: new Date().toISOString() });
  if (recents.length > MAX_RECENT) recents.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  syncRecentMenu();
}

/** Sync the recent projects list to the native File menu */
export async function syncRecentMenu(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const recents = getRecentProjects();
    await invoke('update_recent_menu', { projects: recents });
  } catch {
    // Not in Tauri or command not available
  }
}

export async function openRecentProject(path: string): Promise<void> {
  const jsonPath = `${path}/presentation.json`;
  try {
    if (!(await exists(jsonPath))) {
      await showError('Project not found at this path.');
      return;
    }
    const content = await readTextFile(jsonPath);
    const presentation: Presentation = JSON.parse(content);
    const store = usePresentationStore.getState();
    store.setProjectPath(path);
    store.setPresentation(presentation);
    addRecentProject(path, presentation.title);
  } catch (e) {
    await showError(`Failed to open project: ${e}`);
  }
}

export async function openProject(): Promise<void> {
  const selected = await open({
    directory: true,
    title: 'Open Presentation Project',
  });
  if (!selected) return;

  const projectPath = selected as string;
  const jsonPath = `${projectPath}/presentation.json`;

  try {
    if (!(await exists(jsonPath))) {
      await showError('No presentation.json found in selected directory.');
      return;
    }

    const content = await readTextFile(jsonPath);
    const presentation: Presentation = JSON.parse(content);

    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);
  } catch (e) {
    await showError(`Failed to open project: ${e}`);
  }
}

export async function createProject(): Promise<void> {
  const selected = await open({
    directory: true,
    title: 'Select Directory for New Project',
  });
  if (!selected) return;

  const projectPath = selected as string;
  const presentation = createDefaultPresentation();

  try {
    const demosDir = `${projectPath}/demos`;
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(demosDir))) await mkdir(demosDir);
    if (!(await exists(imagesDir))) await mkdir(imagesDir);

    await writeTextFile(
      `${projectPath}/presentation.json`,
      JSON.stringify(presentation, null, 2)
    );

    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);
  } catch (e) {
    await showError(`Failed to create project: ${e}`);
  }
}

export async function saveProject(): Promise<void> {
  const store = usePresentationStore.getState();

  if (!store.projectPath) {
    // No project open — ask user to pick a directory
    const selected = await open({
      directory: true,
      title: 'Choose a folder to save this presentation',
    });
    if (!selected) return;

    const projectPath = selected as string;
    store.setProjectPath(projectPath);

    // Create subdirectories if they don't exist
    try {
      const demosDir = `${projectPath}/demos`;
      const imagesDir = `${projectPath}/images`;
      if (!(await exists(demosDir))) await mkdir(demosDir);
      if (!(await exists(imagesDir))) await mkdir(imagesDir);
    } catch {
      // dirs may already exist
    }
  }

  const projectPath = usePresentationStore.getState().projectPath;
  if (!projectPath) return;

  try {
    const jsonPath = `${projectPath}/presentation.json`;
    const content = JSON.stringify(usePresentationStore.getState().presentation, null, 2);
    console.log(`Saving to: ${jsonPath}`);
    await writeTextFile(jsonPath, content);
    store.markClean();
    console.log('Save successful');
  } catch (e) {
    console.error('Save failed:', e);
    await showError(`Failed to save: ${e}`);
  }
}

export async function exportPresentation(): Promise<void> {
  const store = usePresentationStore.getState();
  const { presentation, projectPath } = store;

  const selected = await save({
    title: 'Export Presentation',
    defaultPath: `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-')}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!selected) return;

  try {
    const W = presentation.config.width;
    const H = presentation.config.height;
    const meta = [presentation.config.author, presentation.config.venue]
      .filter(Boolean)
      .join(' \u00B7 ');

    // Helper: HTML-escape a string for use in a srcdoc attribute.
    // Only need to escape & and " (since srcdoc is double-quoted).
    // We also escape < and > to be safe — the browser will decode them
    // when parsing the srcdoc value as HTML.
    function htmlEscapeForSrcdoc(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Helper: inject role/piece hash AND a unique channel key into a demo HTML.
    // In srcdoc iframes, location.pathname is empty, so demos that derive their
    // BroadcastChannel name from pathname would all collide. We override the
    // BroadcastChannel constructor to inject a unique prefix per slide+demo.
    function injectDemoBootstrap(html: string, hash: string, channelKey: string): string {
      const bootstrap = `<script>
(function(){
  var __ch = ${JSON.stringify(channelKey)};
  try { window.location.hash = ${JSON.stringify(hash)}; } catch(e) {}
  var _BC = window.BroadcastChannel;
  if (_BC) {
    window.BroadcastChannel = function(name) {
      return new _BC(__ch + ':' + name);
    };
    window.BroadcastChannel.prototype = _BC.prototype;
  }
})();
</script>`;
      // Insert bootstrap right after <head> if present, else at start of <body>
      if (html.includes('<head>')) {
        return html.replace('<head>', '<head>' + bootstrap);
      }
      return bootstrap + html;
    }

    // Read and inline images as data URLs
    const imageCache = new Map<string, string>();
    async function getImageDataUrl(src: string): Promise<string> {
      if (src.startsWith('data:')) return src;
      if (imageCache.has(src)) return imageCache.get(src)!;
      if (!projectPath) return src;
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(`${projectPath}/${src}`);
        const ext = src.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        // Convert bytes to base64 in chunks to avoid stack overflow
        // (String.fromCharCode(...bytes) blows the stack on images > ~50KB)
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunkSize)));
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${mime};base64,${base64}`;
        imageCache.set(src, dataUrl);
        return dataUrl;
      } catch (e) {
        console.error(`Failed to inline image ${src}:`, e);
        return src;
      }
    }

    // Apply math preamble before rendering
    if (presentation.config.mathPreamble) {
      await applyMathPreamble(presentation.config.mathPreamble);
    }

    const slides: string[] = [];

    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      let inner = '';

      // Collect demo-piece srcs for controller iframes
      const demoPieceSrcs = new Set<string>();

      for (const el of slide.elements) {
        const p = el.position;
        switch (el.type) {
          case 'text': {
            const ps = TEXT_PRESET_STYLES[el.preset];
            // Pre-render math to SVG so no MathJax JS needed in export
            let textHtml = el.html;
            if (containsMath(textHtml)) {
              try { textHtml = await renderMathInHtml(textHtml); } catch { /* keep raw */ }
            }
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:${el.fontFamily || ps.fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${el.color || ps.color};line-height:1.3;padding:8px 12px;overflow:hidden;">${textHtml}</div>`;
            break;
          }
          case 'image': {
            const imgSrc = await getImageDataUrl(el.src);
            const imgStyles: string[] = [
              `position:absolute`, `left:${p.x}px`, `top:${p.y}px`,
              `width:${p.width}px`, `height:${p.height}px`, `object-fit:contain`,
            ];
            if (el.shadow) imgStyles.push(`filter:drop-shadow(4px 8px 16px rgba(0,0,0,0.3))`);
            if (el.borderRadius) imgStyles.push(`border-radius:${el.borderRadius}px`);
            if (el.opacity != null && el.opacity < 1) imgStyles.push(`opacity:${el.opacity}`);
            if (el.rotation) imgStyles.push(`transform:rotate(${el.rotation}deg)`);
            inner += `<img src="${imgSrc}" style="${imgStyles.join(';')};" />`;
            break;
          }
          case 'demo':
            if (projectPath) {
              try {
                const demoHtml = await readTextFile(`${projectPath}/${el.src}`);
                const escaped = htmlEscapeForSrcdoc(demoHtml);
                inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
              } catch (e) { console.error('Demo export failed:', e); }
            }
            break;
          case 'demo-piece':
            if (projectPath) {
              demoPieceSrcs.add(el.demoSrc);
              try {
                const demoHtml = await readTextFile(`${projectPath}/${el.demoSrc}`);
                // Each slide-demo combination needs a unique channel name
                // (in srcdoc iframes, location.pathname is empty, so the
                // demo's default channel naming would collide across demos)
                const channelKey = `slide${i}-${el.demoSrc.replace(/[^a-z0-9]/gi, '')}`;
                const pieceHtml = injectDemoBootstrap(demoHtml, `#piece=${el.piece}`, channelKey);
                const escaped = htmlEscapeForSrcdoc(pieceHtml);
                inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
              } catch (e) { console.error('Demo piece export failed:', e); }
            }
            break;
          case 'cover':
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || '#ffffff'};"></div>`;
            break;
          case 'arrow': {
            const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const ha = Math.PI / 6;
            inner += `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">`;
            inner += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
            inner += `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>`;
            inner += `</svg>`;
            break;
          }
        }
      }

      // Add hidden controller iframes for demo-pieces
      for (const demoSrc of demoPieceSrcs) {
        if (projectPath) {
          try {
            const demoHtml = await readTextFile(`${projectPath}/${demoSrc}`);
            const channelKey = `slide${i}-${demoSrc.replace(/[^a-z0-9]/gi, '')}`;
            const ctrlHtml = injectDemoBootstrap(demoHtml, '#role=controller', channelKey);
            const escaped = htmlEscapeForSrcdoc(ctrlHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;width:1px;height:1px;border:none;opacity:0;pointer-events:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) { console.error('Controller iframe export failed:', e); }
        }
      }

      // Footer
      const slideNum = i + 1;
      inner += `<div class="slide-footer"><span class="slide-footer-meta">${meta}</span><span class="slide-footer-number">${slideNum}</span></div>`;

      slides.push(`<div class="slide" data-index="${i}">${inner}</div>`);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${presentation.title}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Sans+Narrow:wght@400;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; overflow: hidden; font-family: 'PT Sans', sans-serif; }
#viewport { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: center; }
.slide {
  width: ${W}px; height: ${H}px; background: #fff; position: relative; overflow: hidden;
  transform-origin: top left; display: none;
}
.slide.active { display: block; }
ul, ol { padding-left: 0; margin: 0; list-style-type: none; }
ul li::before { content: '- '; }
ol { counter-reset: ol-counter; }
ol li::before { counter-increment: ol-counter; content: counter(ol-counter) '. '; }
li { margin-bottom: 0.15em; list-style-position: inside; }
.slide-footer {
  position: absolute; bottom: 20px; right: 40px;
  display: flex; align-items: baseline; gap: 16px;
  font-family: 'PT Sans', sans-serif; color: #999; font-size: 18px;
}
.slide-footer-number { font-size: 24px; }
</style>
</head>
<body>
<div id="viewport">
${slides.join('\n')}
</div>
<!-- eigendeck-source: ${btoa(JSON.stringify(presentation))} -->
<script>
const slides = document.querySelectorAll('.slide');
let current = 0;
const W = ${W}, H = ${H};
function show(i) {
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  resize();
  current = i;
}
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const s = slides[current];
  if (!s) return;
  s.style.transform = 'scale(' + scale + ')';
  // Center the slide
  const wrapper = document.getElementById('viewport');
  wrapper.style.alignItems = 'flex-start';
  wrapper.style.paddingTop = Math.max(0, (vh - H * scale) / 2) + 'px';
}
show(0);
window.addEventListener('resize', resize);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault(); if (current < slides.length - 1) show(current + 1);
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault(); if (current > 0) show(current - 1);
  }
  if (e.key === 'Home') { e.preventDefault(); show(0); }
  if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
});
</script>
</body>
</html>`;

    await writeTextFile(selected, html);
  } catch (e) {
    await showError(`Failed to export: ${e}`);
  }
}

/**
 * Import a presentation from an exported HTML file.
 * Extracts the embedded presentation.json and sets up a project directory.
 */
export async function importFromHtml(): Promise<void> {
  const htmlFile = await open({
    title: 'Import from Exported HTML',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!htmlFile) return;

  try {
    const htmlContent = await readTextFile(htmlFile as string);

    // Extract embedded presentation JSON
    const match = htmlContent.match(/<!-- eigendeck-source: (.+?) -->/);
    if (!match) {
      await showError('This HTML file does not contain embedded Eigendeck data.\n\nOnly files exported from Eigendeck can be imported.');
      return;
    }

    let presentation: Presentation;
    try {
      presentation = JSON.parse(atob(match[1]));
    } catch {
      await showError('Failed to decode embedded presentation data.');
      return;
    }

    // Ask where to create the project directory
    const projectDir = await open({
      directory: true,
      title: 'Select Directory for Imported Project',
    });
    if (!projectDir) return;

    const projectPath = projectDir as string;

    // Create subdirectories
    const demosDir = `${projectPath}/demos`;
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(demosDir))) await mkdir(demosDir);
    if (!(await exists(imagesDir))) await mkdir(imagesDir);

    // Extract inline images (data URLs) back to files
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'image' && el.src.startsWith('data:')) {
          try {
            const mimeMatch = el.src.match(/^data:image\/(\w+);base64,/);
            const ext = mimeMatch?.[1] === 'jpeg' ? 'jpg' : (mimeMatch?.[1] || 'png');
            const fileName = `imported-${el.id.slice(0, 8)}.${ext}`;
            const base64 = el.src.replace(/^data:image\/\w+;base64,/, '');
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(`${imagesDir}/${fileName}`, bytes);
            el.src = `images/${fileName}`;
          } catch (e) {
            console.warn('Failed to extract image:', e);
          }
        }
      }
    }

    // Save presentation.json
    await writeTextFile(
      `${projectPath}/presentation.json`,
      JSON.stringify(presentation, null, 2)
    );

    // Open the imported project
    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);

    console.log('Import successful:', projectPath);
  } catch (e) {
    await showError(`Failed to import: ${e}`);
  }
}
