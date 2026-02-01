// Consolidates high-level app callbacks so App.tsx focuses on data flow.
import { useCallback } from "react";
import type { RefObject } from "react";
import type { SortState } from "@/types";
import { normalizePath } from "@/lib";

type UseAppHandlersOptions = {
  activeTabId: string | null;
  activeTabPath: string;
  currentPath: string;
  loading: boolean;
  activeSearch: string;
  mainRef: RefObject<HTMLElement | null>;
  refresh: () => void | Promise<void>;
  loadDir: (path: string, options?: { sort?: SortState; search?: string; silent?: boolean }) => void;
  jumpTo: (path: string) => void;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  newTab: () => void;
  openInNewTab: (path: string) => void;
  setSort: (next: SortState) => void;
  setTabScrollTop: (id: string, top: number) => void;
  goBack: () => void;
  goForward: () => void;
  sidebarOpen: boolean;
  updateSettings: (patch: { sidebarOpen: boolean }) => void;
  setAboutOpen: (open: boolean) => void;
};

export const useAppHandlers = ({
  activeTabId,
  activeTabPath,
  currentPath,
  loading,
  activeSearch,
  mainRef,
  refresh,
  loadDir,
  jumpTo,
  selectTab,
  closeTab,
  newTab,
  openInNewTab,
  setSort,
  setTabScrollTop,
  goBack,
  goForward,
  sidebarOpen,
  updateSettings,
  setAboutOpen,
}: UseAppHandlersOptions) => {
  const stashActiveScroll = useCallback(() => {
    if (!activeTabId) return;
    const main = mainRef.current;
    if (!main) return;
    const listBody = main.querySelector<HTMLElement>(".list-body");
    if (listBody) {
      setTabScrollTop(activeTabId, listBody.scrollTop);
      return;
    }
    const thumbViewport = main.querySelector<HTMLElement>(".thumb-viewport");
    if (thumbViewport) {
      setTabScrollTop(activeTabId, thumbViewport.scrollTop);
    }
  }, [activeTabId, mainRef, setTabScrollTop]);

  const handleSelectDrive = useCallback((path: string) => jumpTo(path), [jumpTo]);
  const handleSelectPlace = useCallback((path: string) => jumpTo(path), [jumpTo]);

  const handleSelectTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return;
      // Capture the outgoing tab scroll before switching to the next tab.
      stashActiveScroll();
      selectTab(id);
    },
    [activeTabId, selectTab, stashActiveScroll],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      if (id === activeTabId) {
        stashActiveScroll();
      }
      closeTab(id);
    },
    [activeTabId, closeTab, stashActiveScroll],
  );

  const handleNewTab = useCallback(() => {
    stashActiveScroll();
    newTab();
  }, [newTab, stashActiveScroll]);

  const handleOpenInNewTab = useCallback(
    (path: string) => {
      stashActiveScroll();
      openInNewTab(path);
    },
    [openInNewTab, stashActiveScroll],
  );

  const handleToggleSidebar = useCallback(() => {
    updateSettings({ sidebarOpen: !sidebarOpen });
  }, [sidebarOpen, updateSettings]);

  const handleOpenAbout = useCallback(() => setAboutOpen(true), [setAboutOpen]);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), [setAboutOpen]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleBack = useCallback(() => {
    if (loading) return;
    goBack();
  }, [goBack, loading]);

  const handleForward = useCallback(() => {
    if (loading) return;
    goForward();
  }, [goForward, loading]);

  const handleSortChange = useCallback(
    (next: SortState) => {
      setSort(next);
      if (!currentPath || loading) return;
      const activeKey = normalizePath(activeTabPath);
      const currentKey = normalizePath(currentPath);
      if (!currentKey || currentKey !== activeKey) return;
      void loadDir(currentPath, { sort: next, search: activeSearch, silent: true });
    },
    [activeSearch, activeTabPath, currentPath, loadDir, loading, setSort],
  );

  return {
    stashActiveScroll,
    handleSelectDrive,
    handleSelectPlace,
    handleSelectTab,
    handleCloseTab,
    handleNewTab,
    handleOpenInNewTab,
    handleToggleSidebar,
    handleOpenAbout,
    handleCloseAbout,
    handleRefresh,
    handleBack,
    handleForward,
    handleSortChange,
  };
};
