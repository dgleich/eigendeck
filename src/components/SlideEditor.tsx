import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontSize } from './FontSizeExtension';
import { useEffect, useCallback, useRef, useState } from 'react';
import { usePresentationStore } from '../store/presentation';
import { DemoFrame } from './DemoFrame';
import { DraggableImage } from './ImageElement';
import { TextBoxElement } from './TextBoxElement';
import { ArrowElement } from './ArrowElement';
import type { SlideLayout, TextBox, Arrow } from '../types/presentation';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

const FONT_SIZES = ['16px', '20px', '24px', '28px', '32px', '36px', '40px', '48px', '56px', '64px', '72px'];

const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'centered', label: 'Centered' },
  { id: 'two-column', label: '2 Column' },
];

export function SlideEditor() {
  const { presentation, currentSlideIndex, updateSlideContent, updateSlide, projectPath } =
    usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Heading.configure({ levels: [1, 2, 3] }),
      TextStyle,
      FontSize,
    ],
    content: slide?.content.html || '',
    onUpdate: ({ editor }) => {
      updateSlideContent(currentSlideIndex, { html: editor.getHTML() });
    },
  });

  useEffect(() => {
    if (editor && slide) {
      const currentContent = editor.getHTML();
      if (currentContent !== slide.content.html) {
        editor.commands.setContent(slide.content.html || '');
      }
    }
  }, [currentSlideIndex, editor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const padding = 32;
        const availW = width - padding;
        const availH = height - padding;
        const s = Math.min(availW / SLIDE_WIDTH, availH / SLIDE_HEIGHT, 1);
        setScale(s);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Handle Cmd+V / Ctrl+V paste for images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          // Convert to base64 data URL for now (works without a project path)
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // If we have a project path, save to images/ folder
            if (projectPath) {
              saveImageFromBlob(blob, projectPath).then((relativePath) => {
                if (relativePath) {
                  updateSlideContent(currentSlideIndex, {
                    image: relativePath,
                    imagePosition: { x: 360, y: 200, width: 1200, height: 680 },
                  });
                }
              });
            } else {
              // No project path — store as data URL temporarily
              updateSlideContent(currentSlideIndex, {
                image: dataUrl,
                imagePosition: { x: 360, y: 200, width: 1200, height: 680 },
              });
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [currentSlideIndex, projectPath, updateSlideContent]);

  const setHeading = useCallback(
    (level: 1 | 2 | 3) => {
      editor?.chain().focus().toggleHeading({ level }).run();
    },
    [editor]
  );

  const handleUpdateTextBox = useCallback(
    (boxId: string, changes: Partial<TextBox>) => {
      const boxes = [...(slide?.content.textBoxes || [])];
      const idx = boxes.findIndex((b) => b.id === boxId);
      if (idx >= 0) {
        boxes[idx] = { ...boxes[idx], ...changes };
        updateSlideContent(currentSlideIndex, { textBoxes: boxes });
      }
    },
    [slide, currentSlideIndex, updateSlideContent]
  );

  const handleDeleteTextBox = useCallback(
    (boxId: string) => {
      const boxes = (slide?.content.textBoxes || []).filter((b) => b.id !== boxId);
      updateSlideContent(currentSlideIndex, { textBoxes: boxes });
    },
    [slide, currentSlideIndex, updateSlideContent]
  );

  const handleUpdateArrow = useCallback(
    (arrowId: string, changes: Partial<Arrow>) => {
      const arrows = [...(slide?.content.arrows || [])];
      const idx = arrows.findIndex((a) => a.id === arrowId);
      if (idx >= 0) {
        arrows[idx] = { ...arrows[idx], ...changes };
        updateSlideContent(currentSlideIndex, { arrows });
      }
    },
    [slide, currentSlideIndex, updateSlideContent]
  );

  const handleDeleteArrow = useCallback(
    (arrowId: string) => {
      const arrows = (slide?.content.arrows || []).filter((a) => a.id !== arrowId);
      updateSlideContent(currentSlideIndex, { arrows });
    },
    [slide, currentSlideIndex, updateSlideContent]
  );

  if (!slide) return null;

  const layout = slide.layout || 'default';
  const layoutClass = `slide-layout-${layout}`;

  return (
    <div className="slide-editor">
      <div className="editor-toolbar">
        <select
          className="layout-picker"
          value={layout}
          onChange={(e) => updateSlide(currentSlideIndex, { layout: e.target.value as SlideLayout })}
          title="Slide layout"
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="divider" />
        <button
          onClick={() => setHeading(1)}
          className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
          title="Heading 1"
        >
          H1
        </button>
        <button
          onClick={() => setHeading(2)}
          className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}
          title="Heading 2"
        >
          H2
        </button>
        <button
          onClick={() => setHeading(3)}
          className={editor?.isActive('heading', { level: 3 }) ? 'active' : ''}
          title="Heading 3"
        >
          H3
        </button>
        <span className="divider" />
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive('bold') ? 'active' : ''}
          title="Bold (Cmd+B)"
        >
          B
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive('italic') ? 'active' : ''}
          title="Italic (Cmd+I)"
        >
          I
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={editor?.isActive('bulletList') ? 'active' : ''}
          title="Bullet List"
        >
          List
        </button>
        <span className="divider" />
        <select
          className="font-size-picker"
          value=""
          title="Font size"
          onChange={(e) => {
            if (e.target.value) {
              editor?.chain().focus().setFontSize(e.target.value).run();
            }
          }}
        >
          <option value="" disabled>
            Size
          </option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {parseInt(s)}
            </option>
          ))}
        </select>
        <span className="divider" />
        <button
          onClick={() => {
            const isNarrow = editor?.isActive('textStyle', { fontFamily: "'PT Sans Narrow', sans-serif" });
            if (isNarrow) {
              editor?.chain().focus().unsetFontFamily().run();
            } else {
              editor?.chain().focus().setFontFamily("'PT Sans Narrow', sans-serif").run();
            }
          }}
          className={editor?.isActive('textStyle', { fontFamily: "'PT Sans Narrow', sans-serif" }) ? 'active' : ''}
          title="PT Sans Narrow"
        >
          Narrow
        </button>
        <button
          onClick={() => {
            const isUpper = editor?.isActive('textStyle', { textTransform: 'uppercase' });
            if (isUpper) {
              editor?.chain().focus().unsetUppercase().run();
            } else {
              editor?.chain().focus().setUppercase().run();
            }
          }}
          className={editor?.isActive('textStyle', { textTransform: 'uppercase' }) ? 'active' : ''}
          title="Uppercase with letter spacing"
        >
          AA
        </button>
        <span className="divider" />
        <ColorPalette editor={editor} />
      </div>
      <div className="slide-canvas-container" ref={containerRef}>
        <div
          className={`slide-canvas ${layoutClass}`}
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
          }}
        >
          <EditorContent editor={editor} className="editor-content" />
          {slide.content.demo && (
            <DemoFrame
              demoPath={slide.content.demo}
              position={slide.content.demoPosition}
            />
          )}
          {slide.content.image && (
            <DraggableImage
              imagePath={slide.content.image}
              position={slide.content.imagePosition}
              scale={scale}
              onPositionChange={(pos) =>
                updateSlideContent(currentSlideIndex, { imagePosition: pos })
              }
            />
          )}
          {(slide.content.textBoxes || []).map((box) => (
            <TextBoxElement
              key={box.id}
              textBox={box}
              scale={scale}
              onUpdate={handleUpdateTextBox}
              onDelete={handleDeleteTextBox}
            />
          ))}
          {(slide.content.arrows || []).map((arrow) => (
            <ArrowElement
              key={arrow.id}
              arrow={arrow}
              scale={scale}
              onUpdate={handleUpdateArrow}
              onDelete={handleDeleteArrow}
            />
          ))}
          <div className="slide-number-display">
            {currentSlideIndex + 1}
          </div>
        </div>
      </div>
    </div>
  );
}

const COLORS = [
  { color: '#222222', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#d1d5db', label: 'Light Grey' },
  { color: '#16a34a', label: 'Green' },
  { color: '#86efac', label: 'Light Green' },
  { color: '#2563eb', label: 'Blue' },
  { color: '#93c5fd', label: 'Light Blue' },
  { color: '#dc2626', label: 'Red' },
  { color: '#fca5a5', label: 'Light Red' },
  { color: '#ea580c', label: 'Orange' },
  { color: '#fdba74', label: 'Light Orange' },
  { color: '#9333ea', label: 'Purple' },
  { color: '#c4b5fd', label: 'Light Purple' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ColorPalette({ editor }: { editor: any }) {
  const [open, setOpen] = useState(false);

  if (!editor) return null;

  return (
    <div className="color-palette-wrapper">
      <button
        onClick={() => setOpen(!open)}
        title="Text color"
        className="color-palette-btn"
      >
        A<span className="color-indicator" style={{ background: editor.getAttributes('textStyle')?.color || '#222' }} />
      </button>
      {open && (
        <div className="color-palette-dropdown">
          {COLORS.map((c) => (
            <button
              key={c.color}
              className="color-swatch"
              style={{ background: c.color }}
              title={c.label}
              onClick={() => {
                editor.chain().focus().setTextColor(c.color).run();
                setOpen(false);
              }}
            />
          ))}
          <button
            className="color-swatch color-reset"
            title="Reset color"
            onClick={() => {
              editor.chain().focus().unsetTextColor().run();
              setOpen(false);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

async function saveImageFromBlob(blob: File, projectPath: string): Promise<string | null> {
  try {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(imagesDir))) await mkdir(imagesDir);

    const ext = blob.type.split('/')[1] || 'png';
    const fileName = `pasted-${Date.now()}.${ext}`;
    const destPath = `${imagesDir}/${fileName}`;

    const buffer = await blob.arrayBuffer();
    await writeFile(destPath, new Uint8Array(buffer));
    return `images/${fileName}`;
  } catch (e) {
    console.error('Failed to save pasted image:', e);
    return null;
  }
}
