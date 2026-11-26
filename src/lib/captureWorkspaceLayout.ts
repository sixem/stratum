// Read the live layout, including scroll positions that have yet to reach the tab stores.
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { usePlacesStore } from "@/modules/placesStore";
import { useBottomSessionStore, useSessionStore } from "@/modules/sessionStore";
import type { SessionState } from "@/modules/sessionStore";
import type { WorkspaceLayout } from "@/modules/workspaceStore";
import { folderPathKey } from "./paths";

const captureSession = (session: SessionState, pane: "main" | "bottom"): SessionState => {
  const { tabs, activeTabId, recentJumps } = session;
  const files = document.querySelector<HTMLElement>(`[data-file-pane="${pane}"]`);
  const viewport = files?.querySelector<HTMLElement>(".list-body, .thumb-viewport");
  const displayedPath = folderPathKey(files?.dataset.panePath ?? "");
  const remote = files?.querySelector<HTMLElement>(".remote-folder");
  return {
    activeTabId,
    recentJumps: [...recentJumps],
    tabs: tabs.map((tab) => ({
      ...tab,
      sort: { ...tab.sort },
      scrollTop: viewport && tab.id === activeTabId && (tab.kind === "remote"
        ? remote?.dataset.remoteHost === tab.remote.hostId && remote.dataset.remoteFolderPath === tab.remote.path
        : Boolean(displayedPath) && displayedPath === folderPathKey(tab.path))
        ? viewport.scrollTop : tab.scrollTop,
    })),
  };
};

export const captureWorkspaceLayout = (): WorkspaceLayout => {
  const { open, height, heightUnit, active, link } = useBottomPaneStore.getState();
  const { initialized, places } = usePlacesStore.getState();
  return {
    main: captureSession(useSessionStore.getState(), "main"),
    bottom: captureSession(useBottomSessionStore.getState(), "bottom"),
    pane: { open, height, heightUnit, active: open && active, link },
    places: { initialized, places: places.map((place) => ({ ...place })) },
  };
};
