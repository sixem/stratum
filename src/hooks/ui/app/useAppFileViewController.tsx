// File-view orchestration for App.tsx: context menu gating + consolidated FileView props.
import type { PointerEvent as ReactPointerEvent } from "react";
import { useAppFileViewProps } from "./useAppFileViewProps";

type FileViewOptions = Parameters<typeof useAppFileViewProps>[0];

type ContextMenuHandler = ((event: ReactPointerEvent) => void) | undefined;

type UseAppFileViewControllerOptions = {
  sidebarOpen: boolean;
  showLander: boolean;
  onLayoutContextMenu: ContextMenuHandler;
  onLayoutContextMenuDown: ContextMenuHandler;
  fileViewOptions: FileViewOptions;
};

export const useAppFileViewController = ({
  sidebarOpen,
  showLander,
  onLayoutContextMenu,
  onLayoutContextMenuDown,
  fileViewOptions,
}: UseAppFileViewControllerOptions) => {
  // An open folder can accept files even when it has no entries yet.
  const layoutMenuAvailable = !showLander && !fileViewOptions.view.loading;
  const layoutContextMenu = layoutMenuAvailable ? onLayoutContextMenu : undefined;
  const layoutContextMenuDown = layoutMenuAvailable ? onLayoutContextMenuDown : undefined;

  const fileViewProps = useAppFileViewProps({
    ...fileViewOptions,
    contextMenu: {
      ...fileViewOptions.contextMenu,
      onContextMenu: layoutContextMenu,
      onContextMenuDown: layoutContextMenuDown,
    },
  });

  // Layout class toggles full-width mode when the sidebar is closed.
  const layoutClass = `layout${sidebarOpen ? "" : " is-full"}`;

  return {
    fileViewProps,
    layoutClass,
    layoutContextMenu,
    layoutContextMenuDown,
  };
};

