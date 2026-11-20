// Keep the lower pane's navigation, metadata and selection independent of the upper listing.
import { useDeferredValue, useEffect, useRef } from "react";
import { useDirectoryFilter } from "@/hooks/domain/filesystem/useDirectoryFilter";
import { useDirectoryLoader } from "@/hooks/domain/filesystem/useDirectoryLoader";
import { useDirWatch } from "@/hooks/domain/filesystem/useDirWatch";
import { useEntryMetaCache } from "@/hooks/domain/filesystem/useEntryMetaCache";
import { useTabSession } from "@/hooks/domain/session/useTabSession";
import { useFileViewSelection } from "@/hooks/ui/selection/useFileViewSelection";
import { useFileViewModel } from "@/hooks/ui/view/useFileViewModel";
import { folderPathKey, makeDebug } from "@/lib";
import { usePromptStore, useSettingsStore } from "@/modules";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useBottomSessionStore } from "@/modules/sessionStore";

const log = makeDebug("bottom-pane");
const reportError = (title: string, content: string) =>
  usePromptStore.getState().showPrompt({ title, content, confirmLabel: "OK", cancelLabel: null });

export function useBottomFolder(upperPath: string) {
  const loadIdRef = useRef(0);
  const meta = useEntryMetaCache({ loadIdRef, perf: log });
  const dir = useDirectoryLoader({ pane: "bottom", loadIdRef, primeEntryMeta: meta.primeEntryMeta, reportError, perf: log, log });
  const defaultViewMode = useBottomPaneStore(state => state.defaultViewMode);
  const tabs = useTabSession({
    useStore: useBottomSessionStore, currentPath: dir.currentPath, loadingPath: dir.loadingPath,
    loadDir: dir.loadDir, clearDir: dir.clearDir, defaultViewMode, newTabViewMode: defaultViewMode, recentJumpsLimit: 12,
  });
  const navigation = useBottomPaneStore(state => state.navigation);
  useEffect(() => {
    if (navigation && useBottomPaneStore.getState().navigation === navigation) {
      useBottomPaneStore.setState({ navigation: null });
      if (navigation.newTab) tabs.openInNewTab(navigation.path);
      else tabs.jumpTo(navigation.path);
    }
  }, [navigation, tabs.openInNewTab, tabs.jumpTo]);

  const path = dir.currentPath;
  const busy = dir.loadingPath !== null;
  const deferredSearchValue = useDeferredValue(tabs.searchValue);
  useDirectoryFilter({
    activeTabPath: tabs.activeTab?.path ?? "",
    currentPath: path,
    activeSearch: tabs.searchValue,
    deferredSearchValue,
    sortState: tabs.sortState,
    loading: busy,
    loadDir: dir.loadDir,
  });
  useDirWatch({
    pane: "bottom", enabled: "__TAURI_INTERNALS__" in window, sharesWatch: !!path && folderPathKey(upperPath) === folderPathKey(path),
    activeTabId: tabs.activeTabId, activeTabPath: tabs.activeTab?.path ?? "", currentPath: path, tabs: tabs.tabs,
    sortState: tabs.sortState, searchQuery: tabs.searchValue, loadDir: dir.loadDir,
    requestEntryMeta: meta.requestEntryMeta, loading: busy,
  });
  const showParentEntry = useSettingsStore(state => state.showParentEntry);
  const showParent = showParentEntry && !tabs.searchValue.trim() && dir.entries.length > 0;
  const model = useFileViewModel(dir.entries, showParent ? dir.parentPath : null);
  const viewKey = JSON.stringify([tabs.activeTabId, path]);
  const selection = useFileViewSelection({ viewModel: model, resetKey: viewKey });
  return { dir, meta, tabs, model, selection, viewKey, busy, navigation };
}
