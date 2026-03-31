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
    const sections: string[] = [];

    for (const slide of presentation.slides) {
      let sectionContent = slide.content.html || '';

      if (slide.content.demo && projectPath) {
        try {
          const demoPath = `${projectPath}/${slide.content.demo}`;
          const demoHtml = await readTextFile(demoPath);
          const escaped = demoHtml
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          const pos = slide.content.demoPosition || {
            x: 0,
            y: 200,
            width: 800,
            height: 400,
          };
          sectionContent += `\n<iframe srcdoc="${escaped}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;border:none;" sandbox="allow-scripts"></iframe>`;
        } catch {
          sectionContent += '\n<!-- demo file not found -->';
        }
      }

      if (slide.content.image) {
        const pos = slide.content.imagePosition || {
          x: 360,
          y: 200,
          width: 1200,
          height: 680,
        };
        const imgSrcAttr = slide.content.image.startsWith('data:')
          ? slide.content.image
          : slide.content.image;
        sectionContent += `\n<img class="slide-image" src="${imgSrcAttr}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;object-fit:contain;" />`;
      }

      const notesHtml = slide.notes
        ? `\n<aside class="notes">${slide.notes}</aside>`
        : '';
      const layoutAttr = slide.layout ? ` data-layout="${slide.layout}"` : '';
      sections.push(`<section${layoutAttr}>${sectionContent}${notesHtml}</section>`);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${presentation.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/${presentation.theme}.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&display=swap');
    .reveal {
      font-family: 'PT Sans', sans-serif;
      font-size: 32px;
      line-height: 1.4;
      color: #222;
    }
    .reveal .slides { text-align: left; }
    .reveal h1 { font-size: 56px; font-weight: 700; line-height: 1.2; margin-bottom: 24px; color: #222; text-transform: none; text-shadow: none; }
    .reveal h2 { font-size: 44px; font-weight: 700; line-height: 1.2; margin-bottom: 20px; color: #222; text-transform: none; text-shadow: none; }
    .reveal h3 { font-size: 36px; font-weight: 700; line-height: 1.2; margin-bottom: 16px; color: #222; text-transform: none; text-shadow: none; }
    .reveal p { margin-bottom: 16px; }
    .reveal ul, .reveal ol { padding-left: 1.2em; margin-bottom: 16px; }
    .reveal li { margin-bottom: 8px; }
    .reveal section { text-align: left; padding: 60px 80px; position: relative; box-sizing: border-box; }
    .reveal section img.slide-image { position: absolute; object-fit: contain; }
    .reveal section[data-layout="centered"] { display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
    .reveal section[data-layout="two-column"] { column-count:2; column-gap:80px; }
    .reveal .slide-number { font-family:'PT Sans',sans-serif; font-size:24px; color:#999; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${sections.map((s) => '      ' + s).join('\n')}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/notes/notes.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      transition: '${presentation.config.transition}',
      backgroundTransition: '${presentation.config.backgroundTransition}',
      width: ${presentation.config.width},
      height: ${presentation.config.height},
      center: false,
      slideNumber: ${presentation.config.showSlideNumber !== false},
      plugins: [RevealNotes],
    });
  </script>
</body>
</html>`;

    await writeTextFile(selected, html);
  } catch (e) {
    await showError(`Failed to export: ${e}`);
  }
}
