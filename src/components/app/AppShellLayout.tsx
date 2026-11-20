// App shell layout: wires the topstack, content, and status bar.
import { useState } from "react";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import type { PaneSummary } from "../explorer/bottomPane/BottomPane";
import type { ComponentProps } from "react";
import type { AppContentContainerProps } from "./AppContentContainer";
import type { AppTopstackContainerProps } from "./AppTopstackContainer";
import { AppLayout } from "./AppLayout";
import { AppStatusbar } from "./AppStatusbar";

type AppShellLayoutProps = {
  topstack: AppTopstackContainerProps;
  content: Omit<AppContentContainerProps, "onBottomSummary">;
  statusbar: ComponentProps<typeof AppStatusbar>;
};

export const AppShellLayout = ({
  topstack,
  content,
  statusbar,
}: AppShellLayoutProps) => {
  const [bottom, setBottom] = useState<PaneSummary | null>(null);
  const bottomActive = useBottomPaneStore(state => state.open && state.active);
  const focused = bottomActive ? bottom : null;
  const sidebarProps = focused
    ? { ...content.sidebarProps, activePath: focused.path, recentJumps: focused.recentJumps }
    : content.sidebarProps;
  const labels = focused ? { countLabel: focused.countLabel, selectionLabel: focused.selectionLabel } : {};
  return (
    <div className="app-shell-frame">
      <AppLayout topstack={topstack} content={{ ...content, sidebarProps, onBottomSummary: setBottom }} />
      <AppStatusbar statusBar={{ ...statusbar.statusBar, ...labels }} hidden={focused ? !focused.path && statusbar.hidden : statusbar.hidden} />
    </div>
  );
};
