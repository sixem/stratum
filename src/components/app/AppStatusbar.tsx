// Hosts the status bar shell so layout remains stable.
import type { ComponentProps, RefObject } from "react";
import { StatusBar } from "@/components/StatusBar";

type AppStatusbarProps = {
  statusbarRef: RefObject<HTMLDivElement | null>;
  statusBar: ComponentProps<typeof StatusBar>;
};

export const AppStatusbar = ({ statusbarRef, statusBar }: AppStatusbarProps) => {
  return (
    <div className="statusbar-shell" ref={statusbarRef}>
      <StatusBar {...statusBar} />
    </div>
  );
};
