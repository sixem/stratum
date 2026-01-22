// Context menu overlay with viewport-aware positioning.
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContextMenuItem } from "@/types";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MENU_EDGE = 10;
const MENU_GAP = 2;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const alignAxis = (anchor: number, size: number, viewport: number) => {
  const available = viewport - MENU_EDGE * 2;
  if (available <= 0 || size >= available) {
    return MENU_EDGE;
  }
  const maxStart = viewport - MENU_EDGE - size;
  const minStart = MENU_EDGE;

  if (anchor + size + MENU_GAP <= viewport - MENU_EDGE) {
    return anchor + MENU_GAP;
  }
  if (anchor - size - MENU_GAP >= MENU_EDGE) {
    return anchor - size - MENU_GAP;
  }

  return clamp(anchor - size / 2, minStart, maxStart);
};

const getViewportSize = () => {
  const root = document.documentElement;
  return {
    width: root.clientWidth,
    height: root.clientHeight,
  };
};

export const ContextMenu = ({ open, x, y, items, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const menuStyle = useMemo<CSSProperties>(
    () => ({
      left: position.x,
      top: position.y,
    }),
    [position.x, position.y],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = getViewportSize();
    // Align toward the cursor, flipping when space runs out.
    const nextX = alignAxis(x, rect.width, viewport.width);
    const nextY = alignAxis(y, rect.height, viewport.height);
    setPosition({ x: nextX, y: nextY });
  }, [items.length, open, x, y]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleScroll = () => onClose();

    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [onClose, open]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      data-open={open ? "true" : "false"}
      style={menuStyle}
      role="menu"
      aria-hidden={!open}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => {
        if (item.kind === "divider") {
          return <div key={item.id} className="context-divider" role="separator" />;
        }
        const isRadio = typeof item.active === "boolean";
        return (
          <button
            key={item.id}
            type="button"
            className={`context-item${item.active ? " is-active" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            role={isRadio ? "menuitemradio" : "menuitem"}
            aria-checked={isRadio ? (item.active ? true : false) : undefined}
            disabled={item.disabled}
          >
            <span className="context-check">{item.active ? "x" : ""}</span>
            <span className="context-label">{item.label}</span>
            {item.hint ? <span className="context-hint">{item.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
};
