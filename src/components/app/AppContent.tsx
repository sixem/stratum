// Owns the main layout body (sidebar + file view) and the focusable main container.
import { lazy, Suspense, useState } from "react";
import type { CSSProperties, ComponentProps, RefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FileView, PerfProfiler, Sidebar } from "@/components";
import { SidebarDivider } from "@/components/navigation/SidebarDivider";
import { useSettingsStore } from "@/modules";
import { focusFilePaneBackground } from "@/hooks/ui/inputs/inputFocus";
import type { PanePreviewBindings } from "@/hooks/ui/view/useQuickPreview";
import { useTabReveal } from "@/hooks/ui/view/useTabReveal";
import type { BottomMenuBindings } from "@/hooks/ui/app/useAppContextMenus";

import {
  MIN_MAIN_PANE_HEIGHT, PANE_DIVIDER_HEIGHT, setBottomPaneActive, showBottomPane, useBottomPaneStore,
} from "@/modules/bottomPaneStore";
import { PaneDivider } from "../explorer/bottomPane/PaneDivider";
import type { PaneActions, PaneDrop, PaneSummary } from "../explorer/bottomPane/BottomPane";

const BottomPane = lazy(() => import("../explorer/bottomPane/BottomPane").then(module => ({ default: module.BottomPane })));

type AppContentProps = {
  onBottomSummary: (summary: PaneSummary) => void;
  paneActions: PaneActions;
  fileDrop: PaneDrop;
  layoutClass: string;
  folderBusy: boolean;
  folderFailed: boolean;
  onRetryFolder: () => void;
  sidebarOpen: boolean;
  sidebarProps: ComponentProps<typeof Sidebar>;
  activeTabId: string | null;
  mainRef: RefObject<HTMLElement | null>;
  fileViewProps: ComponentProps<typeof FileView>;
  bottomMenu: BottomMenuBindings;
  bottomCommandsBlocked: boolean;
  bottomPreview: PanePreviewBindings;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
};

export const AppContent = ({
  onBottomSummary,
  paneActions,
  fileDrop,
  layoutClass,
  folderBusy,
  folderFailed,
  onRetryFolder,
  sidebarOpen,
  sidebarProps,
  activeTabId,
  mainRef,
  fileViewProps,
  bottomMenu,
  bottomCommandsBlocked,
  bottomPreview,
  onContextMenu,
  onContextMenuDown,
}: AppContentProps) => {
  const split = useBottomPaneStore(state => state.open);
  const bottomHeight = useBottomPaneStore(state => `${state.height}${state.heightUnit}`);
  const bottomActive = useBottomPaneStore(state => state.open && state.active);
  const sidebarWidth = useSettingsStore(state => state.sidebarWidth);
  const animateTabChanges = useSettingsStore(state => state.animateTabChanges);
  useTabReveal(mainRef, {
    tabId: activeTabId,
    ready: !folderBusy && !folderFailed && !fileViewProps.loading,
    enabled: animateTabChanges,
    view: fileViewProps.showLander ? "lander" : fileViewProps.viewMode,
    viewKey: fileViewProps.viewKey,
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const paneViewProps = { ...fileViewProps, gridResizeDeferred: sidebarResizing };
  const upperPath = fileViewProps.loading || fileViewProps.showLander ? "" : fileViewProps.currentPath;
  return (
    <PerfProfiler id="app-content">
      <div
        className={layoutClass}
        data-split={split}
        data-active-pane={bottomActive ? "bottom" : "main"}
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
          "--bottom-height": bottomHeight,
          "--pane-divider-height": `${PANE_DIVIDER_HEIGHT}px`,
          "--main-pane-min-height": `${MIN_MAIN_PANE_HEIGHT}px`,
        } as CSSProperties}
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
            <SidebarDivider width={sidebarWidth} onResizeChange={setSidebarResizing} />
          </PerfProfiler>
        ) : null}
        <div className="pane-stack" data-split={split}>
        <main className="main upper-files" data-file-pane="main" data-pane-path={upperPath}
          data-start-view={fileViewProps.showLander || undefined}
          data-drop-background={fileDrop.backgroundHovered && fileDrop.hoveredPane === "main" || undefined}
          onPointerDownCapture={event => {
            setBottomPaneActive(false);
            focusFilePaneBackground(event);
          }}
          onFocusCapture={() => setBottomPaneActive(false)} ref={mainRef} tabIndex={-1} aria-busy={folderBusy}>
          {folderBusy && (
            <div className="folder-load-progress" role="progressbar" aria-label="Loading folder" />
          )}
          <PerfProfiler id="file-view">
            {folderFailed ? (
              <div className="pane-loading">
                <button className="btn ghost" type="button" onClick={onRetryFolder}>Retry opening folder</button>
              </div>
            ) : (
              <FileView {...paneViewProps} dropTargetPath={fileDrop.hoveredPane === "main" ? fileDrop.dropTargetPath : null} />
            )}
          </PerfProfiler>
        </main>
        {split && <>
          <PaneDivider />
          <Suspense fallback={<div className="pane-loading">Opening bottom pane…</div>}>
            <BottomPane upper={paneViewProps} actions={paneActions} drop={fileDrop} menu={bottomMenu} commandsBlocked={bottomCommandsBlocked}
              onSummary={onBottomSummary} bottomPreview={bottomPreview} />
          </Suspense>
        </>}
        </div>
      </div>
    </PerfProfiler>
  );
};
