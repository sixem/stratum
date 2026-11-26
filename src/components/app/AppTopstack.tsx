// Renders the app header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps } from "react";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useRemoteNavigation } from "../remote/useRemoteNavigation";
import { PathBar } from "@/components/explorer/PathBar";
import { PathInputsBar } from "@/components/explorer/PathInputsBar";
import { PathCrumbsBar } from "@/components/explorer/PathCrumbsBar";
import { TabsBar } from "@/components/navigation/TabsBar";
import { WorkspacePicker } from "@/components/navigation/WorkspacePicker";
import { TerminalDirectoryBar } from "@/components/terminal/TerminalDirectoryBar";

type AppTopstackProps = {
  pathBar: ComponentProps<typeof PathBar>;
  pathInputsBar: ComponentProps<typeof PathInputsBar>;
  tabsBar: ComponentProps<typeof TabsBar>;
  crumbsBar: ComponentProps<typeof PathCrumbsBar>;
};

export const AppTopstack = ({
  pathBar,
  pathInputsBar,
  tabsBar,
  crumbsBar,
}: AppTopstackProps) => {
  const split = useBottomPaneStore((state) => state.open);
  const activeTab = tabsBar.tabs.find(tab => tab.id === tabsBar.activeId);
  const terminal = activeTab?.terminal;
  const remote = activeTab?.kind === "remote" ? activeTab : null;
  const nav = useRemoteNavigation(remote, "main");
  const focusMain = (event: { target: EventTarget }) => {
    if (event.target instanceof Element && event.target.closest("[data-workspace-picker], [data-remotes-picker]")) return;
    setBottomPaneActive(false);
  };
  return (
    <div className="topstack" onPointerDownCapture={focusMain} onFocusCapture={focusMain}>
      <div className="header">
        <PathBar {...pathBar} {...(remote ? nav.steps : {})} />
        <div className="path-tabs">
          <PathInputsBar {...pathInputsBar} {...(remote ? {
            path: nav.path, onPathChange: nav.setPath, onSubmit: nav.submit, onRefresh: nav.refresh,
            loading: false, search: remote.search, onSearchChange: nav.setSearch, filterSelectionKeys: undefined,
          } : {})} />
          <TabsBar {...tabsBar} leading={<WorkspacePicker />} />
        </div>
      </div>
      {remote ? <PathCrumbsBar remoteHost={nav.host} trailPath={remote.crumbTrailPath} path={remote.remote.path} onNavigate={nav.navigate} onNavigateNewTab={nav.openTab} /> : terminal ? <TerminalDirectoryBar directory={terminal.directory} /> : <PathCrumbsBar {...crumbsBar} reserveSpace={split} />}
    </div>
  );
};
