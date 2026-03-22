// Hosts the status bar shell so layout remains stable.
import type { ComponentProps } from "react";
import { StatusBar } from "@/components/navigation/StatusBar";

type AppStatusbarProps = {
  statusBar: ComponentProps<typeof StatusBar>;
  hidden?: boolean;
};

export const AppStatusbar = ({
  statusBar,
  hidden = false,
}: AppStatusbarProps) => {
  return (
    <div className={`statusbar-shell${hidden ? " is-hidden" : ""}`}>
      <StatusBar {...statusBar} />
    </div>
  );
};
