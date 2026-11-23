// Coordinate deliberate navigation between the two active tabs in a saved pair.
import { create } from "zustand";
import { getLinkedPaneFolder, relativeLinkedPath } from "@/lib/paneLink";
import type { LinkedPane } from "@/lib/paneLink";
import { folderPathKey } from "@/lib/paths";
import { useBottomPaneStore } from "./bottomPaneStore";
import { getPaneSessionStore, useBottomSessionStore, useSessionStore } from "./sessionStore";

export type LinkedNavigation = {
  isCurrent: () => boolean;
  onUnavailable: () => void;
};

type Receiver = (path: string, navigation: LinkedNavigation) => void;

const receivers: Partial<Record<LinkedPane, Receiver>> = {};
let revision = 0;

export const usePaneLinkIssue = create<{ unavailablePath: string | null }>()(() => ({ unavailablePath: null }));

const invalidate = () => {
  revision += 1;
  if (usePaneLinkIssue.getState().unavailablePath) usePaneLinkIssue.setState({ unavailablePath: null });
};

for (const store of [useSessionStore, useBottomSessionStore]) {
  store.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.restoreRevision !== previous.restoreRevision) invalidate();
  });
}
useBottomPaneStore.subscribe((next, previous) => {
  if (next.link !== previous.link || next.open !== previous.open) invalidate();
});

export const registerPaneLinkReceiver = (pane: LinkedPane, receive: Receiver) => {
  receivers[pane] = receive;
  return () => {
    if (receivers[pane] === receive) delete receivers[pane];
  };
};

export const closeLinkedTab = (pane: LinkedPane, tabId: string) => {
  const { link } = useBottomPaneStore.getState();
  if (link && (pane === "main" ? link.mainTabId : link.bottomTabId) === tabId) {
    useBottomPaneStore.setState({ link: null });
  }
};

export const beginLinkedNavigation = (pane: LinkedPane, tabId: string | null, path: string) => {
  invalidate();
  const requestRevision = revision;
  const { link, open } = useBottomPaneStore.getState();
  if (!link || !open || (pane === "main" ? link.mainTabId : link.bottomTabId) !== tabId) return;
  const peer = pane === "main" ? "bottom" : "main";
  const peerTabId = peer === "main" ? link.mainTabId : link.bottomTabId;
  const peerRoot = peer === "main" ? link.mainRootPath : link.bottomRootPath;
  const folder = getLinkedPaneFolder(link, pane, path);
  if (!folder) return;

  const isCurrent = () => {
    const state = useBottomPaneStore.getState();
    return revision === requestRevision && state.open && state.link === link &&
      useSessionStore.getState().activeTabId === link.mainTabId &&
      useBottomSessionStore.getState().activeTabId === link.bottomTabId;
  };

  // Only a displayed source directory can send a mirror request. Register its
  // intent earlier so an older reply cannot override a newer pane action.
  return () => {
    if (!isCurrent()) return;
    const peerTab = getPaneSessionStore(peer).getState().tabs.find(({ id }) => id === peerTabId);
    if (!peerTab || relativeLinkedPath(peerRoot, peerTab.path) === null ||
        folderPathKey(folder) === folderPathKey(peerTab.path)) return;
    receivers[peer]?.(folder, {
      isCurrent,
      onUnavailable: () => {
        if (isCurrent()) usePaneLinkIssue.setState({ unavailablePath: folder });
      },
    });
  };
};
