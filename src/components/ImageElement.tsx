import { usePresentationStore } from '../store/presentation';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open, message } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import type { ImagePosition } from '../types/presentation';

interface ImageElementProps {
  imagePath: string;
  position?: ImagePosition;
}

export function ImageElement({ imagePath, position }: ImageElementProps) {
  const { projectPath } = usePresentationStore();
  const pos = position || { x: 100, y: 150, width: 700, height: 450 };

  let src: string | undefined;
  if (projectPath) {
    try {
      src = convertFileSrc(`${projectPath}/${imagePath}`);
    } catch {
      src = `${projectPath}/${imagePath}`;
    }
  }

  if (!src) return null;

  return (
    <div
      className="image-element"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}

export function AddImageButton() {
  const { currentSlideIndex, updateSlideContent, projectPath } =
    usePresentationStore();

  const handleAddImage = async () => {
    if (!projectPath) {
      await message('Please save or open a project first (File > New or Open).', {
        title: 'No Project Open',
        kind: 'info',
      });
      return;
    }

    const selected = await open({
      title: 'Select Image',
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'],
        },
      ],
    });
    if (!selected) return;

    const fullPath = selected as string;

    // Copy image to project's images/ folder
    const imagesDir = `${projectPath}/images`;
    try {
      if (!(await exists(imagesDir))) {
        await mkdir(imagesDir);
      }
    } catch {
      // directory might already exist
    }

    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop() || 'image.png';
    const destPath = `${imagesDir}/${fileName}`;

    // Only copy if source is outside the project
    if (!fullPath.startsWith(projectPath)) {
      try {
        const data = await readFile(fullPath);
        await writeFile(destPath, data);
      } catch (e) {
        console.error('Failed to copy image:', e);
        // Try using the original path as a relative reference
      }
    }

    const relativePath = fullPath.startsWith(projectPath)
      ? fullPath.slice(projectPath.length + 1)
      : `images/${fileName}`;

    updateSlideContent(currentSlideIndex, {
      image: relativePath,
      imagePosition: { x: 80, y: 150, width: 700, height: 450 },
    });
  };

  return (
    <button
      onClick={handleAddImage}
      title="Add image to slide"
    >
      + Image
    </button>
  );
}

export function RemoveImageButton() {
  const { presentation, currentSlideIndex, updateSlideContent } =
    usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide?.content.image) return null;

  return (
    <button
      onClick={() =>
        updateSlideContent(currentSlideIndex, {
          image: undefined,
          imagePosition: undefined,
        })
      }
      title="Remove image from slide"
    >
      - Image
    </button>
  );
}
