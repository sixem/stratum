// Resize the sidebar in the layout and persist the final width.
import { useEffect, useRef } from "react";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "@/constants";
import { useSettingsStore } from "@/modules";

const KEYBOARD_STEP = 16;

type Resize = {
  pointerId: number;
  startX: number;
  startWidth: number;
  nextWidth: number;
  frame: number | null;
  divider: HTMLDivElement;
  layout: HTMLElement;
};

function clampWidth(width: number) {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(width)));
}

function widthAt(resize: Resize, x: number) {
  return clampWidth(resize.startWidth + x - resize.startX);
}

function saveWidth(sidebarWidth: number) {
  const settings = useSettingsStore.getState();
  if (settings.sidebarWidth !== sidebarWidth) settings.updateSettings({ sidebarWidth });
}

function clearPreview(resize: Resize) {
  if (resize.frame !== null) window.cancelAnimationFrame(resize.frame);
  resize.layout.style.removeProperty("--sidebar-width-preview");
  resize.divider.removeAttribute("data-resizing");
  resize.divider.setAttribute("aria-valuenow", String(useSettingsStore.getState().sidebarWidth));
}

type SidebarDividerProps = {
  width: number;
  onResizeChange: (resizing: boolean) => void;
};

export function SidebarDivider({ width, onResizeChange }: SidebarDividerProps) {
  const drag = useRef<Resize | null>(null);

  const endResize = (pointerId: number) => {
    const resize = drag.current;
    if (!resize || resize.pointerId !== pointerId) return;
    drag.current = null;
    clearPreview(resize);
    onResizeChange(false);
  };

  useEffect(() => () => {
    if (!drag.current) return;
    clearPreview(drag.current);
    drag.current = null;
    onResizeChange(false);
  }, [onResizeChange]);

  return (
    <div
      className="sidebar-divider"
      role="separator"
      tabIndex={0}
      aria-label="Sidebar width"
      aria-controls="app-sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      onPointerDown={event => {
        event.stopPropagation();
        if (event.button !== 0 || drag.current) return;
        const divider = event.currentTarget;
        const layout = divider.parentElement;
        if (!layout) return;

        event.preventDefault();
        divider.focus({ preventScroll: true });
        divider.setPointerCapture(event.pointerId);
        divider.setAttribute("data-resizing", "true");
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          nextWidth: width,
          frame: null,
          divider,
          layout,
        };
        onResizeChange(true);
      }}
      onPointerMove={event => {
        const resize = drag.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        const next = widthAt(resize, event.clientX);
        if (next === resize.nextWidth) return;
        resize.nextWidth = next;
        if (resize.frame !== null) return;

        // Coalesce pointer updates and keep React and storage out of the drag loop.
        resize.frame = window.requestAnimationFrame(() => {
          resize.frame = null;
          resize.layout.style.setProperty("--sidebar-width-preview", `${resize.nextWidth}px`);
          resize.divider.setAttribute("aria-valuenow", String(resize.nextWidth));
        });
      }}
      onPointerUp={event => {
        event.stopPropagation();
        const resize = drag.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        saveWidth(widthAt(resize, event.clientX));
        endResize(event.pointerId);
      }}
      onPointerCancel={event => endResize(event.pointerId)}
      onLostPointerCapture={event => endResize(event.pointerId)}
      onKeyDown={event => {
        const resize = drag.current;
        if (event.key === "Escape" && resize) {
          event.preventDefault();
          event.stopPropagation();
          resize.divider.releasePointerCapture(resize.pointerId);
          endResize(resize.pointerId);
          return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || resize) return;
        const current = useSettingsStore.getState().sidebarWidth;
        let next: number;
        switch (event.key) {
          case "ArrowLeft": next = current - KEYBOARD_STEP; break;
          case "ArrowRight": next = current + KEYBOARD_STEP; break;
          case "Home": next = SIDEBAR_WIDTH_MIN; break;
          case "End": next = SIDEBAR_WIDTH_MAX; break;
          default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        saveWidth(clampWidth(next));
      }}
    />
  );
}
