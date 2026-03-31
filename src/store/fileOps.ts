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
    const selected = await save({
      title: 'Save Presentation',
      defaultPath: 'presentation.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected) return;

    const projectPath = selected.replace(/[/\\]presentation\.json$/, '') || selected;
    store.setProjectPath(projectPath);
  }

  try {
    const jsonPath = `${store.projectPath}/presentation.json`;
    const content = JSON.stringify(store.presentation, null, 2);
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

      if (slide.content.image && projectPath) {
        try {
          const pos = slide.content.imagePosition || {
            x: 100,
            y: 150,
            width: 700,
            height: 450,
          };
          sectionContent += `\n<img src="${slide.content.image}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px;" />`;
        } catch {
          sectionContent += '\n<!-- image not found -->';
        }
      }

      const notesHtml = slide.notes
        ? `\n<aside class="notes">${slide.notes}</aside>`
        : '';
      sections.push(`<section>${sectionContent}${notesHtml}</section>`);
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
      font-size: 42px;
      line-height: 1.3;
      color: #222;
    }
    .reveal h1 { font-size: 72px; font-weight: 700; line-height: 1.2; margin-bottom: 24px; color: #222; text-transform: none; text-shadow: none; }
    .reveal h2 { font-size: 56px; font-weight: 700; line-height: 1.2; margin-bottom: 20px; color: #222; text-transform: none; text-shadow: none; }
    .reveal h3 { font-size: 44px; font-weight: 700; line-height: 1.2; margin-bottom: 16px; color: #222; text-transform: none; text-shadow: none; }
    .reveal p { margin-bottom: 16px; }
    .reveal ul, .reveal ol { padding-left: 1.2em; margin-bottom: 16px; }
    .reveal li { margin-bottom: 8px; }
    .reveal section { text-align: left; padding: 40px 60px; }
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
