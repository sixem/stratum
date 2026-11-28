// Hosts the status bar shell so layout remains stable.
import type { ComponentProps } from "react";
import { StatusBar } from "@/components/navigation/StatusBar";

import { useRemoteStatus } from "@/modules/remoteStatus";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useUpdateStore } from "@/modules/updateStore";

type AppStatusbarProps = {
  statusBar: ComponentProps<typeof StatusBar>;
};

export const AppStatusbar = ({ statusBar }: AppStatusbarProps) => {
  const pane = useBottomPaneStore(s => s.open && s.active ? "bottom" : "main");
  const remote = useRemoteStatus(s => s[pane]);
  const update = useUpdateStore(s => s.status);
  const current = remote ? { ...remote,
    message: remote.message || statusBar.message,
    level: remote.message ? remote.level : statusBar.level,
  } : statusBar;
  const updateMessage = update === "checking" ? "Checking for updates" : update === "applying" ? "Applying update" : "";
  const visible = updateMessage && current.level === "idle" && (!current.message || current.message === "Ready")
    ? { ...current, message: updateMessage, level: "loading" as const } : current;
  return (
    <div className="statusbar-shell">
      <StatusBar {...visible} />
    </div>
  );
};
