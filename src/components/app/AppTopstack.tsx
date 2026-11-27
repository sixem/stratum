// Renders the app header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps, ReactNode } from "react";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useRemoteDrag } from "@/modules/remoteDrag";
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
  crumbsInContent?: boolean;
  renderContent?: (crumbs: ReactNode) => ReactNode;
};

export const AppTopstack = ({
  pathBar,
  pathInputsBar,
  tabsBar,
  crumbsBar,
  crumbsInContent = false,
  renderContent,
}: AppTopstackProps) => {
  const split = useBottomPaneStore((state) => state.open);
  const remoteDropPath = useRemoteDrag(state => state.preview?.action !== "unavailable" && state.preview &&
    state.target?.kind === "entry" && state.target.pane === "main" ? state.target.path : null);
  const remoteCrumbDropPath = useRemoteDrag(state => state.remoteTarget?.kind === "remote-crumb" &&
    state.remoteTarget.pane === "main" ? state.remoteTarget.path : null);
  const activeTab = tabsBar.tabs.find(tab => tab.id === tabsBar.activeId);
  const terminal = activeTab?.terminal;
  const remote = activeTab?.kind === "remote" ? activeTab : null;
  const nav = useRemoteNavigation(remote, "main");
  const focusMain = (event: { target: EventTarget }) => {
    if (event.target instanceof Element && event.target.closest("[data-workspace-picker], [data-remotes-picker]")) return;
    setBottomPaneActive(false);
  };
  const crumbs = remote
    ? <PathCrumbsBar remoteHost={nav.host} remoteProfileId={remote.remote.hostId} dropTargetPath={remoteCrumbDropPath}
      trailPath={remote.crumbTrailPath} path={remote.remote.path} onNavigate={nav.navigate} onNavigateNewTab={nav.openTab} />
    : terminal ? <TerminalDirectoryBar directory={terminal.directory} /> : <PathCrumbsBar {...crumbsBar}
      dropTargetPath={remoteDropPath ?? crumbsBar.dropTargetPath} reserveSpace={split} />;
  return (
    <>
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
      {!crumbsInContent && crumbs}
    </div>
    {renderContent?.(crumbsInContent ? crumbs : null)}
    </>
  );
};
