import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: false;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handleClick, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handleClick, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position to keep menu on screen
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div ref={ref} className="context-menu" style={{ left: x, top: y }}>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="context-menu-sep" />;
        }
        return (
          <button
            key={i}
            className="context-menu-item"
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
