// Hosts the status bar shell so layout remains stable.
import type { ComponentProps, RefObject } from "react";
import { StatusBar } from "@/components/navigation/StatusBar";

type AppStatusbarProps = {
  statusbarRef: RefObject<HTMLDivElement | null>;
  statusBar: ComponentProps<typeof StatusBar>;
  hidden?: boolean;
};

export const AppStatusbar = ({
  statusbarRef,
  statusBar,
  hidden = false,
}: AppStatusbarProps) => {
  return (
    <div
      className={`statusbar-shell${hidden ? " is-hidden" : ""}`}
      ref={statusbarRef}
    >
      <StatusBar {...statusBar} />
    </div>
  );
};
