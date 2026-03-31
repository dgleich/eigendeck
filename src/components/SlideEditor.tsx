import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import { useEffect, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { DemoFrame } from './DemoFrame';

export function SlideEditor() {
  const { presentation, currentSlideIndex, updateSlideContent } =
    usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Heading.configure({ levels: [1, 2, 3] }),
    ],
    content: slide?.content.html || '',
    onUpdate: ({ editor }) => {
      updateSlideContent(currentSlideIndex, { html: editor.getHTML() });
    },
  });

  // Sync editor content when slide changes
  useEffect(() => {
    if (editor && slide) {
      const currentContent = editor.getHTML();
      if (currentContent !== slide.content.html) {
        editor.commands.setContent(slide.content.html || '');
      }
    }
  }, [currentSlideIndex, editor]);

  const setHeading = useCallback(
    (level: 1 | 2 | 3) => {
      editor?.chain().focus().toggleHeading({ level }).run();
    },
    [editor]
  );

  if (!slide) return null;

  return (
    <div className="slide-editor">
      <div className="editor-toolbar">
        <button
          onClick={() => setHeading(1)}
          className={
            editor?.isActive('heading', { level: 1 }) ? 'active' : ''
          }
        >
          H1
        </button>
        <button
          onClick={() => setHeading(2)}
          className={
            editor?.isActive('heading', { level: 2 }) ? 'active' : ''
          }
        >
          H2
        </button>
        <button
          onClick={() => setHeading(3)}
          className={
            editor?.isActive('heading', { level: 3 }) ? 'active' : ''
          }
        >
          H3
        </button>
        <span className="divider" />
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive('bold') ? 'active' : ''}
        >
          B
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive('italic') ? 'active' : ''}
        >
          I
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={editor?.isActive('bulletList') ? 'active' : ''}
        >
          List
        </button>
      </div>
      <div className="slide-canvas" style={{ fontFamily: "'PT Sans', sans-serif" }}>
        <EditorContent editor={editor} className="editor-content" />
        {slide.content.demo && (
          <DemoFrame
            demoPath={slide.content.demo}
            position={slide.content.demoPosition}
          />
        )}
      </div>
    </div>
  );
}
