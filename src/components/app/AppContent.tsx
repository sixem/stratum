// Owns the main layout body (sidebar + file view) and the focusable main container.
import type { ComponentProps, RefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FileView, PerfProfiler, Sidebar } from "@/components";

type AppContentProps = {
  layoutClass: string;
  sidebarOpen: boolean;
  sidebarProps: ComponentProps<typeof Sidebar>;
  mainRef: RefObject<HTMLElement | null>;
  fileViewProps: ComponentProps<typeof FileView>;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
};

export const AppContent = ({
  layoutClass,
  sidebarOpen,
  sidebarProps,
  mainRef,
  fileViewProps,
  onContextMenu,
  onContextMenuDown,
}: AppContentProps) => {
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
            <Sidebar {...sidebarProps} />
          </PerfProfiler>
        ) : null}
        <main className="main" ref={mainRef} tabIndex={-1}>
          <PerfProfiler id="file-view">
            <FileView {...fileViewProps} />
          </PerfProfiler>
        </main>
      </div>
    </PerfProfiler>
  );
};
