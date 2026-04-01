import { open, save, message } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs';
import {
  Presentation,
  createDefaultPresentation,
} from '../types/presentation';
import { usePresentationStore } from './presentation';

async function showError(msg: string) {
  await message(msg, { title: 'Error', kind: 'error' });
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

    const slides: string[] = [];

    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      const layout = slide.layout || 'default';
      let inner = '';

      // Body
      if (slide.bodyHtml) {
        inner += `<div class="slide-body ${layout === 'centered' ? 'layout-centered' : ''} ${layout === 'two-column' ? 'layout-twocol' : ''}">${slide.bodyHtml}</div>`;
      }

      // Elements in z-order
      for (const el of slide.elements) {
        const p = el.position;
        switch (el.type) {
          case 'title':
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:'PT Sans',sans-serif;font-weight:700;font-size:${el.fontSize || 56}px;color:#222;line-height:1.2;padding:8px 12px;">${el.text}</div>`;
            break;
          case 'textBox':
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:'PT Sans',sans-serif;font-size:32px;line-height:1.4;color:#222;padding:12px 16px;overflow:hidden;">${el.html}</div>`;
            break;
          case 'image':
            inner += `<img src="${el.src}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;" />`;
            break;
          case 'demo':
            if (projectPath) {
              try {
                const demoHtml = await readTextFile(`${projectPath}/${el.src}`);
                const escaped = demoHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts"></iframe>`;
              } catch { /* skip */ }
            }
            break;
          case 'arrow': {
            const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = el;
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

      // Footer
      inner += `<div class="slide-footer"><span>${meta}</span><span>${i + 1}</span></div>`;

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
  transform-origin: center center; display: none;
}
.slide.active { display: block; }
.slide-body {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  font-family: 'PT Sans', sans-serif; font-size: 32px; line-height: 1.4; color: #222;
  padding: 60px 80px;
}
.slide-body h1 { font-size: 56px; font-weight: 700; margin-bottom: 24px; }
.slide-body h2 { font-size: 44px; font-weight: 700; margin-bottom: 20px; }
.slide-body h3 { font-size: 36px; font-weight: 700; margin-bottom: 16px; }
.slide-body p { margin-bottom: 16px; }
.slide-body ul, .slide-body ol { padding-left: 1.2em; margin-bottom: 16px; }
.slide-body li { margin-bottom: 8px; }
.layout-centered { display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
.layout-centered ul, .layout-centered ol { display:inline-block; text-align:left; padding-left:1em; list-style-position:inside; }
.layout-twocol { column-count: 2; column-gap: 80px; }
.slide-footer {
  position: absolute; bottom: 20px; left: 80px; right: 40px;
  display: flex; justify-content: space-between;
  font-family: 'PT Sans', sans-serif; color: #999; font-size: 18px;
}
.slide-footer span:last-child { font-size: 24px; }
</style>
</head>
<body>
<div id="viewport">
${slides.join('\n')}
</div>
<script>
const slides = document.querySelectorAll('.slide');
let current = 0;
function show(i) {
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  // Scale to fit
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = slides[i];
  const scale = Math.min(vw / ${W}, vh / ${H});
  s.style.transform = 'scale(' + scale + ')';
  current = i;
}
show(0);
window.addEventListener('resize', () => show(current));
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
