// File-view orchestration for App.tsx: context menu gating + consolidated FileView props.
import type { PointerEvent as ReactPointerEvent } from "react";
import { useAppFileViewProps } from "./useAppFileViewProps";

type FileViewOptions = Parameters<typeof useAppFileViewProps>[0];

type ContextMenuHandler = ((event: ReactPointerEvent) => void) | undefined;

type UseAppFileViewControllerOptions = {
  sidebarOpen: boolean;
  showLander: boolean;
  showEmptyFolder: boolean;
  onLayoutContextMenu: ContextMenuHandler;
  onLayoutContextMenuDown: ContextMenuHandler;
  fileViewOptions: FileViewOptions;
};

export const useAppFileViewController = ({
  sidebarOpen,
  showLander,
  showEmptyFolder,
  onLayoutContextMenu,
  onLayoutContextMenuDown,
  fileViewOptions,
}: UseAppFileViewControllerOptions) => {
  // Gate layout-level context menu handlers when there is no file surface to target.
  const layoutMenuAvailable = !showLander && !showEmptyFolder && !fileViewOptions.view.loading;
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

