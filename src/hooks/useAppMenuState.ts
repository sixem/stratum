// Centralizes overlay and context menu state for the app shell.
import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EntryContextTarget } from "@/types";

type ContextMenuPoint = { x: number; y: number };

type ContextMenuState =
  | ({ kind: "sort" } & ContextMenuPoint)
  | ({ kind: "entry"; entry: EntryContextTarget } & ContextMenuPoint)
  | null;

export const useAppMenuState = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSortMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({ kind: "sort", x: event.clientX, y: event.clientY });
  }, []);

  const openEntryMenu = useCallback((event: ReactMouseEvent, entry: EntryContextTarget) => {
    event.preventDefault();
    setContextMenu({
      kind: "entry",
      x: event.clientX,
      y: event.clientY,
      entry,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return {
    contextMenu,
    settingsOpen,
    openSortMenu,
    openEntryMenu,
    closeContextMenu,
    toggleSettings,
    closeSettings,
  };
};
