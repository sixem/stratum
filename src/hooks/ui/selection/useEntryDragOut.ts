// Hand a file gesture to the Windows shell as soon as it crosses the drag threshold.
import { useCallback, useEffect, useRef } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
import { DRAG_THRESHOLD_PX } from "@/constants";
import type { EntryDragHandler } from "@/types";

type EntryDragOptions = {
  selected: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onStartDrag?: EntryDragHandler;
  loading: boolean;
};

type Press = {
  id: number;
  source: Element;
  path: string;
  isFolder: boolean;
  x: number;
  y: number;
  selection: Set<string> | null;
};

export const useEntryDragOut = ({ selected, onSetSelection, onStartDrag, loading }: EntryDragOptions) => {
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  const release = useCallback(() => {
    const previous = press.current;
    press.current = null;
    if (previous?.source.hasPointerCapture(previous.id)) {
      previous.source.releasePointerCapture(previous.id);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", release);
      release();
    };
  }, [release]);

  const onPointerDownCapture = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    release();
    suppressClick.current = false;
    // Touch pans the file pane. The shell drag loop follows a held primary button.
    if (event.pointerType === "touch") return;
    const source = event.target;
    if (loading || !onStartDrag || !(source instanceof Element)) return;
    const entry = source.closest<HTMLElement>('[data-drag-source="true"]');
    const path = entry?.dataset.remotePath ?? entry?.dataset.path;
    if (!entry || !path) return;

    // Capture on the original child so a fast exit still delivers movement and
    // ordinary clicks, double-clicks and row selection keep their original target.
    source.setPointerCapture(event.pointerId);
    press.current = {
      id: event.pointerId, source, path, isFolder: entry.dataset.isDir === "true", x: event.clientX, y: event.clientY,
      selection: selected.has(path) ? selected : null,
    };
  };

  const onPointerMoveCapture = (event: PointerEvent) => {
    const start = press.current;
    if (!start || start.id !== event.pointerId) return;
    if (!(event.buttons & 1) || loading || !onStartDrag || !start.source.isConnected) {
      release();
      return;
    }
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;

    // Keep the grabbed group when Ctrl/Shift mousedown changed its selection.
    const selection = start.selection ?? selected;
    const paths = selection.has(start.path) ? Array.from(selection) : [start.path];
    release();
    suppressClick.current = true;
    if (selection !== selected || !selected.has(start.path)) onSetSelection(paths, start.path);
    onStartDrag(paths, start.isFolder ? start.path : undefined, {
      x: event.clientX, y: event.clientY, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey,
    });
  };

  const endPress = (event: PointerEvent) => {
    if (press.current?.id === event.pointerId) release();
  };
  const suppressDragClick = (event: MouseEvent) => {
    if (!suppressClick.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: endPress,
    onPointerCancelCapture: endPress,
    onLostPointerCapture: endPress,
    onClickCapture: suppressDragClick,
    onDoubleClickCapture: suppressDragClick,
    // Prevent WebView2 from starting a competing HTML drag on an image.
    onDragStart: (event: DragEvent) => event.preventDefault(),
  };
};
