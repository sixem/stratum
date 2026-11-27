// Adapt either pane's saved tab to the remote directory view.
import { useCallback, useEffect, useMemo } from "react";
import type { PanePreviewBindings } from "@/hooks/ui/view/useQuickPreview";
import type { RemoteTab } from "@/types/tabs";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { navigateRemoteTab } from "@/lib/remoteNavigation";
import { openRemoteTab, updateRemoteTab } from "@/modules/remoteTabs";
import { RemoteFolderView } from "./RemoteFolderView";

export function RemoteTabPane({ pane, tab, preview, onPreviewRelease }: { pane: LinkedPane; tab: RemoteTab; preview: PanePreviewBindings; onPreviewRelease?: (path: string) => boolean }) {
  const { id, remote, remoteHistory } = tab;
  const visit = useCallback((path: string) => updateRemoteTab(pane, id, current =>
    navigateRemoteTab(current, { path })), [pane, id]);
  // Persist once scrolling settles. Switching tabs flushes the last offset, while
  // navigation in the same tab keeps the new folder's offset independent.
  const scroll = useMemo(() => {
    let timer: number | undefined;
    let pending: number | undefined;
    const flush = () => {
      window.clearTimeout(timer);
      const store = getPaneSessionStore(pane).getState();
      const current = store.tabs.find(t => t.id === id);
      if (pending !== undefined && current?.kind === "remote" && current.remote.path === remote.path) {
        store.setTabScrollTop(id, pending);
      }
      pending = undefined;
    };
    return { flush, save(top: number) {
      pending = top;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 160);
    } };
  }, [pane, id, remote.path]);
  useEffect(() => scroll.flush, [scroll]);
  return <RemoteFolderView preview={preview} onPreviewRelease={onPreviewRelease} pane={pane} tabId={id} refreshVersion={tab.refreshVersion} hostId={remote.hostId} path={remote.path} sort={tab.sort} search={tab.search}
    viewMode={tab.viewMode} scrollTop={tab.scrollTop} onScrollTop={scroll.save}
    canBack={!!remoteHistory?.back.length} canForward={!!remoteHistory?.forward.length}
    onBack={() => updateRemoteTab(pane, id, current => navigateRemoteTab(current, "back"))}
    onForward={() => updateRemoteTab(pane, id, current => navigateRemoteTab(current, "forward"))}
    onNavigate={visit} onOpenTab={path => openRemoteTab(remote.hostId, path, pane)}
    onSort={sort => updateRemoteTab(pane, id, current => ({ ...current, sort, scrollTop: 0 }))} />;
}
