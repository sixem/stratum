// Owns the main layout body (sidebar + file view) and the focusable main container.
import type { ComponentProps, RefObject } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { FileView } from "@/components/FileView";
import { Sidebar } from "@/components/Sidebar";

type AppContentProps = {
  layoutClass: string;
  sidebarOpen: boolean;
  sidebarProps: ComponentProps<typeof Sidebar>;
  mainRef: RefObject<HTMLElement | null>;
  fileViewProps: ComponentProps<typeof FileView>;
  onContextMenu?: (event: ReactMouseEvent) => void;
};

export const AppContent = ({
  layoutClass,
  sidebarOpen,
  sidebarProps,
  mainRef,
  fileViewProps,
  onContextMenu,
}: AppContentProps) => {
  return (
    <div className={layoutClass} onContextMenu={onContextMenu}>
      {sidebarOpen ? <Sidebar {...sidebarProps} /> : null}
      <main className="main" ref={mainRef} tabIndex={-1}>
        <FileView {...fileViewProps} />
      </main>
    </div>
  );
};
