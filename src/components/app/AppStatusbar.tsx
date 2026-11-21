// Hosts the status bar shell so layout remains stable.
import type { ComponentProps } from "react";
import { StatusBar } from "@/components/navigation/StatusBar";

type AppStatusbarProps = {
  statusBar: ComponentProps<typeof StatusBar>;
};

export const AppStatusbar = ({ statusBar }: AppStatusbarProps) => {
  return (
    <div className="statusbar-shell">
      <StatusBar {...statusBar} />
    </div>
  );
};
