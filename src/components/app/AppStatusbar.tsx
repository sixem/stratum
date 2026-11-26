// Hosts the status bar shell so layout remains stable.
import type { ComponentProps } from "react";
import { StatusBar } from "@/components/navigation/StatusBar";

import { useRemoteStatus } from "@/modules/remoteStatus";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";

type AppStatusbarProps = {
  statusBar: ComponentProps<typeof StatusBar>;
};

export const AppStatusbar = ({ statusBar }: AppStatusbarProps) => {
  const pane = useBottomPaneStore(s => s.open && s.active ? "bottom" : "main");
  const remote = useRemoteStatus(s => s[pane]);
  return (
    <div className="statusbar-shell">
      <StatusBar {...(remote ?? statusBar)} />
    </div>
  );
};
