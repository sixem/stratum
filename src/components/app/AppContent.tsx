// Owns the main layout body (sidebar + file view) and the focusable main container.
import { lazy, Suspense } from "react";
import type { CSSProperties, ComponentProps, RefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FileView, PerfProfiler, Sidebar } from "@/components";
import type { PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";

import { useBottomPaneStore, showBottomPane, setBottomPaneActive } from "@/modules/bottomPaneStore";
import { PaneDivider } from "../explorer/bottomPane/PaneDivider";
import type { PaneActions, PaneDrop, PaneSummary } from "../explorer/bottomPane/BottomPane";

const BottomPane = lazy(() => import("../explorer/bottomPane/BottomPane").then(module => ({ default: module.BottomPane })));

type AppContentProps = {
  onBottomSummary: (summary: PaneSummary) => void;
  paneActions: PaneActions;
  fileDrop: PaneDrop;
  layoutClass: string;
  folderBusy: boolean;
  sidebarOpen: boolean;
  sidebarProps: ComponentProps<typeof Sidebar>;
  mainRef: RefObject<HTMLElement | null>;
  fileViewProps: ComponentProps<typeof FileView>;
  onOpenGallery: (path: string, source: PreviewGallerySource) => void;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
};

export const AppContent = ({
  onBottomSummary,
  paneActions,
  fileDrop,
  layoutClass,
  folderBusy,
  sidebarOpen,
  sidebarProps,
  mainRef,
  fileViewProps,
  onOpenGallery,
  onContextMenu,
  onContextMenuDown,
}: AppContentProps) => {
  const split = useBottomPaneStore(state => state.open);
  const height = useBottomPaneStore(state => state.height);
  const bottomActive = useBottomPaneStore(state => state.open && state.active);
  const upperPath = fileViewProps.loading || fileViewProps.showLander ? "" : fileViewProps.currentPath;
  return (
    <PerfProfiler id="app-content">
      <div
        className={layoutClass}
        onPointerDown={(event) => {
          if (event.button !== 2) return;
          onContextMenuDown?.(event);
        }}
        onPointerUp={(event) => {
          if (event.button !== 2) return;
          onContextMenu?.(event);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {sidebarOpen ? (
          <PerfProfiler id="sidebar">
            <Sidebar {...sidebarProps} {...(bottomActive && {
              onSelect: (path: string) => showBottomPane(path, false),
              onSelectRecent: (path: string) => showBottomPane(path, false),
              onSelectNewTab: (path: string) => showBottomPane(path),
            })} />
          </PerfProfiler>
        ) : null}
        <div className="pane-stack" data-split={split} data-active-pane={bottomActive ? "bottom" : "main"}
          style={{ "--bottom-height": height + "%" } as CSSProperties}>
        <main className="main upper-files" data-file-pane="main" data-pane-path={upperPath}
          data-drop-background={fileDrop.backgroundHovered && fileDrop.hoveredPane === "main" || undefined}
          onPointerDownCapture={() => setBottomPaneActive(false)}
          onFocusCapture={() => setBottomPaneActive(false)} ref={mainRef} tabIndex={-1} aria-busy={folderBusy}>
          {folderBusy && (
            <div className="folder-load-progress" role="progressbar" aria-label="Loading folder" />
          )}
          <PerfProfiler id="file-view">
            <FileView {...fileViewProps} dropTargetPath={fileDrop.hoveredPane === "main" ? fileDrop.dropTargetPath : null} />
          </PerfProfiler>
        </main>
        {split && <>
          <PaneDivider />
          <Suspense fallback={<div className="pane-loading">Opening bottom pane…</div>}>
            <BottomPane upper={fileViewProps} actions={paneActions} drop={fileDrop}
              onSummary={onBottomSummary} onOpenGallery={onOpenGallery} />
          </Suspense>
        </>}
        </div>
      </div>
    </PerfProfiler>
  );
};
