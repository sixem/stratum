// Apply the startup preference before React opens the first folder.
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { createSessionTab } from "./sessionStore";
import { useSettingsStore } from "./settings.store";
import { switchWorkspace, useWorkspaceStore } from "./workspaceStore";

export const applyStartupSession = () => {
  const { startupMode, startupWorkspaceId, defaultViewMode } = useSettingsStore.getState();
  if (startupMode === "resume") return;

  const { activeId, workspaces, drafts } = useWorkspaceStore.getState();
  if (startupMode === "workspace") {
    const saved = workspaces.find(({ id }) => id === startupWorkspaceId);
    if (!saved || saved.id === activeId) return;
    // Use the same draft that a manual switch from the workspace picker opens.
    const target = drafts.find(({ id }) => id === saved.id) ?? saved;
    switchWorkspace(target, captureWorkspaceLayout());
    return;
  }

  const outgoing = captureWorkspaceLayout();
  if (!activeId && !outgoing.pane.open && !outgoing.bottom.tabs.length &&
    outgoing.main.tabs.length <= 1 && !outgoing.main.tabs[0]?.path.trim()) return;

  const tab = createSessionTab("", { viewMode: defaultViewMode });
  // Keep places and recent locations available on the Start browsing screen.
  // The old tabs and split layout remain reachable from Previous session.
  switchWorkspace({
    id: null,
    layout: {
      ...outgoing,
      main: { ...outgoing.main, tabs: [tab], activeTabId: tab.id },
      bottom: { ...outgoing.bottom, tabs: [], activeTabId: null },
      pane: { ...outgoing.pane, open: false, active: false, link: null },
    },
  }, outgoing);
};
