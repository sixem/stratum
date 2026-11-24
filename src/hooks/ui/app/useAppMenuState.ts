// Centralizes overlay and context menu state for the app shell.
import { useCallback, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import type { ContextMenuItem, EntryContextTarget, PlaceContextTarget } from "@/types";

type ContextMenuPoint = { x: number; y: number };
type ContextMenuEvent = ReactMouseEvent | ReactPointerEvent;

type ContextMenuState =
  | ({ kind: "sort"; listHeader?: boolean } & ContextMenuPoint)
  | ({ kind: "entry"; entry: EntryContextTarget } & ContextMenuPoint)
  | ({ kind: "place-target"; target: PlaceContextTarget } & ContextMenuPoint)
  | ({ kind: "history"; items: ContextMenuItem[] } & ContextMenuPoint)
  | null;

type MenuPane = "main" | "bottom";
type OwnedMenu = { pane: MenuPane; menu: NonNullable<ContextMenuState> };

// Both panes render the same menu, using one active menu owner at a time.
function usePaneMenuState(pane: MenuPane, active: OwnedMenu | null, setActive: Dispatch<SetStateAction<OwnedMenu | null>>) {
  const openContextMenuAt = useCallback((menu: NonNullable<ContextMenuState>) => {
    setActive({ pane, menu });
  }, [pane, setActive]);

  const openSortMenu = useCallback((event: ContextMenuEvent) => {
    event.preventDefault();
    const listHeader = event.target instanceof Element && Boolean(event.target.closest("[data-list-header]"));
    openContextMenuAt({ kind: "sort", listHeader, x: event.clientX, y: event.clientY });
  }, [openContextMenuAt]);

  const openEntryMenu = useCallback((event: ContextMenuEvent, entry: EntryContextTarget) => {
    event.preventDefault();
    openContextMenuAt({
      kind: "entry",
      x: event.clientX,
      y: event.clientY,
      entry,
    });
  }, [openContextMenuAt]);

  const openPlaceTargetMenu = useCallback(
    (event: ContextMenuEvent, target: PlaceContextTarget) => {
      event.preventDefault();
      openContextMenuAt({
        kind: "place-target",
        x: event.clientX,
        y: event.clientY,
        target,
      });
    },
    [openContextMenuAt],
  );

  const closeContextMenu = useCallback(() => {
    setActive(current => current?.pane === pane ? null : current);
  }, [pane, setActive]);

  return {
    contextMenu: active?.pane === pane ? active.menu : null,
    openContextMenuAt,
    openSortMenu,
    openEntryMenu,
    openPlaceTargetMenu,
    closeContextMenu,
  };
}

export const useAppMenuState = () => {
  const [activeMenu, setActiveMenu] = useState<OwnedMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mainMenu = usePaneMenuState("main", activeMenu, setActiveMenu);
  const bottomMenu = usePaneMenuState("bottom", activeMenu, setActiveMenu);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return {
    ...mainMenu,
    bottomMenu,
    contextMenuActive: activeMenu !== null,
    settingsOpen,
    toggleSettings,
    closeSettings,
  };
};
