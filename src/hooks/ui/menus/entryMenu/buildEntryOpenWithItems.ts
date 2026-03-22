// Builds the "Open with" submenu from the resolved handler state.

import type { ContextMenuItem } from "@/types";
import type { EntryMenuOpenWithState } from "./types";

type BuildEntryOpenWithItemsOptions = {
  isDir: boolean;
  openWithMenuState: EntryMenuOpenWithState;
  onOpenWithHandler: (path: string, handlerId: string) => void;
  onChooseOpenWith: (path: string) => void;
};

export const buildEntryOpenWithItems = ({
  isDir,
  openWithMenuState,
  onOpenWithHandler,
  onChooseOpenWith,
}: BuildEntryOpenWithItemsOptions): ContextMenuItem[] => {
  const showOpenWith = !isDir && Boolean(openWithMenuState.targetPath);
  if (!showOpenWith) return [];

  const openWithMenuItems: ContextMenuItem[] = [];
  if (openWithMenuState.status === "loading") {
    openWithMenuItems.push({
      id: "entry-open-with-loading",
      label: "Loading apps...",
      onSelect: () => undefined,
      disabled: true,
    });
  } else if (openWithMenuState.status === "error") {
    openWithMenuItems.push({
      id: "entry-open-with-error",
      label: "Couldn't load apps",
      onSelect: () => undefined,
      disabled: true,
    });
  } else if (openWithMenuState.handlers.length === 0) {
    openWithMenuItems.push({
      id: "entry-open-with-empty",
      label: "No apps found",
      onSelect: () => undefined,
      disabled: true,
    });
  } else {
    openWithMenuItems.push(
      ...openWithMenuState.handlers.map((handler) => ({
        id: `entry-open-with-${handler.id}`,
        label: handler.label,
        onSelect: () => {
          if (!openWithMenuState.targetPath) return;
          onOpenWithHandler(openWithMenuState.targetPath, handler.id);
        },
      })),
    );
  }

  openWithMenuItems.push({ kind: "divider", id: "entry-open-with-divider-choose" });
  openWithMenuItems.push({
    id: "entry-open-with-choose",
    label: "Choose...",
    icon: "open-external",
    onSelect: () => {
      if (!openWithMenuState.targetPath) return;
      onChooseOpenWith(openWithMenuState.targetPath);
    },
  });

  return [
    {
      kind: "submenu",
      id: "entry-open-with",
      label: "Open with",
      items: openWithMenuItems,
    },
  ];
};
