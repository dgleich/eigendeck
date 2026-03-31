import { open, save } from '@tauri-apps/plugin-dialog';
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

export async function openProject(): Promise<void> {
  const selected = await open({
    directory: true,
    title: 'Open Presentation Project',
  });
  if (!selected) return;

  const projectPath = selected as string;
  const jsonPath = `${projectPath}/presentation.json`;

  if (!(await exists(jsonPath))) {
    throw new Error('No presentation.json found in selected directory');
  }

  const content = await readTextFile(jsonPath);
  const presentation: Presentation = JSON.parse(content);

  const store = usePresentationStore.getState();
  store.setProjectPath(projectPath);
  store.setPresentation(presentation);
}

export async function createProject(): Promise<void> {
  const selected = await open({
    directory: true,
    title: 'Select Directory for New Project',
  });
  if (!selected) return;

  const projectPath = selected as string;
  const presentation = createDefaultPresentation();

  // Create subdirectories
  const demosDir = `${projectPath}/demos`;
  const imagesDir = `${projectPath}/images`;
  if (!(await exists(demosDir))) await mkdir(demosDir);
  if (!(await exists(imagesDir))) await mkdir(imagesDir);

  // Write presentation.json
  await writeTextFile(
    `${projectPath}/presentation.json`,
    JSON.stringify(presentation, null, 2)
  );

  const store = usePresentationStore.getState();
  store.setProjectPath(projectPath);
  store.setPresentation(presentation);
}

export async function saveProject(): Promise<void> {
  const store = usePresentationStore.getState();
  if (!store.projectPath) {
    // No project path — ask where to save
    const selected = await save({
      title: 'Save Presentation',
      defaultPath: 'presentation.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected) return;

    // Derive project path from selected file
    const projectPath = selected.replace(/\/presentation\.json$/, '');
    store.setProjectPath(projectPath);
  }

  const jsonPath = `${store.projectPath}/presentation.json`;
  await writeTextFile(
    jsonPath,
    JSON.stringify(store.presentation, null, 2)
  );
  store.markClean();
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

  const sections: string[] = [];

  for (const slide of presentation.slides) {
    let sectionContent = slide.content.html || '';

    // Inline demo if present
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

    // Inline image if present
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
    .reveal { font-family: 'PT Sans', sans-serif; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${sections.map((s) => '      ' + s).join('\n')}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      transition: '${presentation.config.transition}',
      backgroundTransition: '${presentation.config.backgroundTransition}',
      width: ${presentation.config.width},
      height: ${presentation.config.height},
    });
  </script>
</body>
</html>`;

  await writeTextFile(selected, html);
}
