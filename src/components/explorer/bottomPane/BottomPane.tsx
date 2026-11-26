// Secondary workspace with its own tabs, navigation, and file selection.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { createPortal } from "react-dom";
import { useDriveInfo } from "@/hooks/domain/filesystem/useDriveInfo";
import { useStatusLabels } from "@/hooks/domain/metadata/useStatusLabels";
import { useScrollRequest } from "@/hooks/perf/scroll";
import type { ScrollAlignment } from "@/hooks/perf/scroll";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { TerminalDirectoryBar } from "@/components/terminal/TerminalDirectoryBar";
import { TerminalSplitControls } from "@/components/terminal/TerminalSplitControls";
import { TerminalSplitView } from "@/components/terminal/TerminalSplitView";
import { FileView } from "../FileView";
import { PathCrumbsBar } from "../PathCrumbsBar";
import { TabsBar } from "@/components/navigation/TabsBar";
import { ChevronDownIcon, ChevronUpIcon, FilterIcon, GridIcon, ListIcon, NavArrowIcon, TabCloseIcon } from "@/components/icons";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { FileFilterHint } from "@/components/primitives/FileFilterHint";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { useDragOutHandler } from "@/hooks/ui/inputs/useDragOutHandler";
import { useTabHistoryMenu } from "@/hooks/ui/menus/useTabHistoryMenu";
import type { BottomMenuBindings } from "@/hooks/ui/app/useAppContextMenus";
import { useSmartTabJump } from "@/hooks/ui/selection/useSmartTabJump";
import { useTypeaheadSelection } from "@/hooks/ui/selection/useTypeaheadSelection";
import type { PanePreviewBindings, PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import { useNavigationReveal } from "@/hooks/ui/view/useNavigationReveal";
import { useTabReveal } from "@/hooks/ui/view/useTabReveal";
import { useSettingsStore } from "@/modules";
import { hideBottomPane, setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { folderPathKey, getNextTrailPath } from "@/lib";
import type { useFileManager } from "@/hooks/domain/filesystem/useFileManager";
import type { useFileDrop } from "@/hooks/domain/filesystem/useFileDrop";
import { bottomPaneKeys } from "./bottomPaneKeys";
import { useBottomFolder } from "./useBottomFolder";
import { useBottomPaneActions } from "./useBottomPaneActions";
import { PaneLinkControls } from "./PaneLinkControls";

export type PaneActions = ReturnType<typeof useFileManager>;
export type PaneDrop = ReturnType<typeof useFileDrop>;
export type PaneSummary = {
  path: string;
  countLabel: string;
  selectionLabel: string;
};
type Props = {
  upper: ComponentProps<typeof FileView>;
  actions: PaneActions;
  drop: PaneDrop;
  onSummary: (summary: PaneSummary) => void;
  bottomPreview: PanePreviewBindings;
  menu: BottomMenuBindings;
  commandsBlocked: boolean;
};

export function BottomPane({ upper, actions, drop, onSummary, bottomPreview, menu, commandsBlocked }: Props) {
  const folder = useBottomFolder();
  const { dir, meta, tabs, model, selection, viewKey, busy } = folder;
  const terminal = tabs.activeTab?.terminal;
  const handleHistoryMenu = useTabHistoryMenu(tabs, menu.openActionMenu);
  const root = useRef<HTMLElement>(null);
  const files = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const filterHintId = useId();
  const [draft, setDraft] = useState(tabs.displayPath);
  const gridColumns = useRef(1);
  const updateGridColumns = useCallback((columns: number) => { gridColumns.current = columns; }, []);
  const { scrollRequest, requestScrollToIndex } = useScrollRequest();
  const tabNumbers = useSettingsStore(state => state.showTabNumbers);
  const fixedWidth = useSettingsStore(state => state.fixedWidthTabs);
  const animateTabChanges = useSettingsStore(state => state.animateTabChanges);
  const active = useBottomPaneStore(state => state.active);
  const showBreadcrumbs = useBottomPaneStore(state => state.showBreadcrumbs);
  const path = dir.currentPath;
  const { currentDriveInfo } = useDriveInfo({
    currentPath: path, drives: upper.drives, driveInfo: upper.driveInfo,
  });
  const { countLabel, selectionLabel } = useStatusLabels({
    isFiltered: !!tabs.searchValue.trim(), visibleCount: dir.entries.length, totalCount: dir.totalCount,
    currentDriveInfo, selected: selection.selected, entryMeta: meta.entryMeta,
  });
  useLayoutEffect(() => {
    onSummary({ path, countLabel, selectionLabel });
  }, [onSummary, path, countLabel, selectionLabel]);
  // The listing can commit one render before its tab is updated.
  const ready = !!path && !busy && !tabs.restoringTabs && folderPathKey(path) === folderPathKey(tabs.displayPath);
  useTabReveal(files, {
    tabId: tabs.activeTabId,
    ready: ready || (!tabs.displayPath && !busy && !tabs.restoringTabs),
    enabled: animateTabChanges,
    view: tabs.displayPath ? tabs.viewMode : "lander",
    pathKey: folderPathKey(tabs.displayPath),
  });
  const viewVisit = useMemo(() => ({ current: false }), [viewKey, tabs.searchValue]);
  useLayoutEffect(() => {
    viewVisit.current = ready;
    return () => { viewVisit.current = false; };
  }, [ready, viewVisit]);
  const selectEntry = selection.setSelection;
  const bottomGallery = useMemo<PreviewGallerySource>(() => ({
    items: dir.entries,
    entryByPath: model.entryByPath,
    onSelectPath: (selectedPath) => {
      if (viewVisit.current) selectEntry([selectedPath], selectedPath);
    },
  }), [dir.entries, model.entryByPath, selectEntry, viewVisit]);
  const registerPreviewSource = bottomPreview.registerSource;
  const { getSelectionSnapshot } = selection;
  useLayoutEffect(() => {
    if (!ready || !root.current || !files.current) return;
    return registerPreviewSource({
      getGallery: () => bottomGallery,
      paneRoot: root.current,
      filesRoot: files.current,
      isCurrent: () => viewVisit.current,
      getSelectionSnapshot,
    });
  }, [bottomGallery, getSelectionSnapshot, ready, registerPreviewSource, viewVisit]);
  const nextTrailPath = ready ? getNextTrailPath(path, tabs.activeTab?.crumbTrailPath) : null;
  const paths = useMemo(() => Array.from(selection.selected).filter(item => model.entryByPath.has(item)),
    [selection.selected, model.entryByPath]);
  useLayoutEffect(() => setDraft(tabs.displayPath), [tabs.displayPath, tabs.activeTabId]);
  const focusFiles = useCallback(() => { files.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (useBottomPaneStore.getState().active) focusFiles();
  }, [focusFiles]);
  // A sidebar jump belongs to the pane it opened. Its next keyboard action
  // should operate on the new folder even when the sidebar button took focus.
  useLayoutEffect(() => {
    if (folder.navigation) focusFiles();
  }, [focusFiles, folder.navigation]);
  const scrollTop = useRef<number | null>(null);
  const { activeTabId, setTabScrollTop } = tabs;
  useLayoutEffect(() => {
    scrollTop.current = null;
    return () => {
      if (activeTabId && scrollTop.current !== null) setTabScrollTop(activeTabId, scrollTop.current);
    };
  }, [activeTabId, setTabScrollTop]);
  const closeTab = (id: string, close = tabs.closeTab) => {
    const outgoing = id === activeTabId ? scrollTop.current ?? undefined : undefined;
    focusFiles();
    close(id, outgoing);
  };
  const navigate = (next: string) => { if (next.trim()) tabs.browseTo(next.trim()); };
  const clearSearchAndFocusFiles = () => {
    tabs.setSearch("");
    focusFiles();
  };
  const browseFromView = (next: string) => {
    if (!next.trim()) return;
    focusFiles();
    tabs.browseTo(next);
  };
  const openNew = tabs.openInNewTab;
  const openLocationTab = useCallback((location: string) => {
    focusFiles();
    openNew(location);
  }, [focusFiles, openNew]);
  const dragOut = useDragOutHandler({
    beginFileActivity: actions.beginFileActivity, viewParentPath: dir.parentPath, onRefresh: dir.refreshAfterChange,
  });
  const scrollTo = useCallback((index: number, alignment?: ScrollAlignment) => {
    requestScrollToIndex(index, viewKey, alignment);
  }, [requestScrollToIndex, viewKey]);
  useNavigationReveal({
    path: tabs.navigationRevealPath,
    viewKey,
    loading: !ready,
    viewModel: model,
    setSelection: selectEntry,
    scrollToIndex: scrollTo,
  });
  const paneActions = useBottomPaneActions({
    folder, actions, menu, files, ready, viewVisit, browseFromView, openGallery: bottomPreview.open, scrollTo,
    onCloseAnchoredTab: id => closeTab(id, tabs.closeAnchoredTab),
    hideExtension: upper.gridNameHideExtension,
    clearDragState: drop.clearDragState,
  });
  const handleTypeahead = useTypeaheadSelection({
    items: model.items,
    resetKeys: [active, ready, viewKey, tabs.searchValue, tabs.viewMode],
    onMatch: ({ path, index }) => {
      // Keep keyboard focus in this pane when scrolling moves a row out of view.
      focusFiles();
      paneActions.handleSelectionChange([path], path);
      scrollTo(index, tabs.viewMode === "list" ? "center" : "nearest");
    },
  });
  const handleTabJump = useSmartTabJump(files, active && ready ? `${viewKey}:${tabs.viewMode}` : null);
  const onKey = bottomPaneKeys({
    folder, actions, address, files, paths, ready, closeTab, commandsBlocked, gridColumns,
    openContextMenu: paneActions.openKeyboardContextMenu,
    startRename: paneActions.handleRenameStart, clearSelection: paneActions.clearSelectionForVisit,
    undo: paneActions.undo, moveEntries: paneActions.moveEntries,
    paneFileCommands: paneActions.paneFileCommands,
    scrollTo: (index) => { focusFiles(); scrollTo(index); },
    handleTypeahead, handleTabJump, searchInput, clearSearchAndFocusFiles, browseFromView,
  });
  const nextView = tabs.viewMode === "list" ? "thumbs" : "list";
  const viewSwitchLabel = nextView === "thumbs" ? "Switch to thumbnails" : "Switch to list";

  return <section ref={root} className="bottom-pane" aria-label="Bottom pane" tabIndex={-1}
    onKeyDown={onKey} onFocusCapture={() => setBottomPaneActive(true)}
    onPointerDownCapture={event => {
      if (!event.currentTarget.contains(event.target as Node)) return;
      setBottomPaneActive(true);
      if ((event.target as Element).closest("[data-terminal]")) return;
      if (!(event.target as Element).closest("button, input, [tabindex='0']") ||
          (event.button === 2 && !event.currentTarget.contains(document.activeElement))) {
        focusFiles();
      }
    }}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    <nav className="bottom-nav" aria-label="Bottom pane navigation">
      <ToolbarIconButton
        label="Back"
        ariaLabel="Bottom pane back"
        disabled={!tabs.canGoBack}
        onClick={tabs.goBack}
        onContextMenu={(event) => handleHistoryMenu(event, "back")}
        pressOnPointerDown={false}
      >
        <NavArrowIcon className="nav-arrow is-back" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Forward"
        ariaLabel="Bottom pane forward"
        disabled={!tabs.canGoForward}
        onClick={tabs.goForward}
        onContextMenu={(event) => handleHistoryMenu(event, "forward")}
        pressOnPointerDown={false}
      >
        <NavArrowIcon />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Parent folder"
        ariaLabel="Bottom pane parent folder"
        disabled={!dir.parentPath || busy}
        onClick={() => dir.parentPath && navigate(dir.parentPath)}
        pressOnPointerDown={false}
      >
        <ChevronUpIcon />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Down one level"
        ariaLabel="Bottom pane down one level"
        disabled={!nextTrailPath}
        onClick={() => nextTrailPath && navigate(nextTrailPath)}
        pressOnPointerDown={false}
      >
        <ChevronDownIcon />
      </ToolbarIconButton>
      <form onSubmit={event => { event.preventDefault(); navigate(draft); focusFiles(); }}>
        <input ref={address} aria-label="Bottom pane folder" value={draft} placeholder="Folder path" onChange={event => setDraft(event.target.value)} />
      </form>
      <label className="bottom-search">
        <FileFilterHint id={filterHintId}><FilterIcon /></FileFilterHint>
        <input
          ref={searchInput}
          aria-label="Search bottom folder"
          aria-describedby={filterHintId}
          value={tabs.searchValue}
          onChange={event => tabs.setSearch(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
          disabled={!tabs.activeTab?.path}
          placeholder="Search"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {!showBreadcrumbs && tabs.activeTab?.split && <TerminalSplitControls pane="bottom" />}
      <ToolbarIconButton
        label={viewSwitchLabel}
        onClick={() => tabs.setViewMode(nextView)}
        pressOnPointerDown={false}
      >
        {nextView === "thumbs" ? <GridIcon /> : <ListIcon />}
      </ToolbarIconButton>
      <PaneLinkControls mainPath={upper.loading ? "" : upper.currentPath}
        bottomPath={ready ? path : ""} bottomTabId={activeTabId} />
      {!terminal && <ToolbarIconButton
        label={showBreadcrumbs ? "Hide path bar" : "Show path bar"}
        ariaLabel="Bottom pane path bar"
        active={showBreadcrumbs}
        pressed={showBreadcrumbs}
        onClick={() => useBottomPaneStore.setState({ showBreadcrumbs: !showBreadcrumbs })}
        pressOnPointerDown={false}
      >
        <ChevronDownIcon className="bottom-path-chevron" />
      </ToolbarIconButton>}
      <ToolbarIconButton label="Hide bottom pane" onClick={hideBottomPane} pressOnPointerDown={false}>
        <TabCloseIcon />
      </ToolbarIconButton>
    </nav>
    <TabsBar pane="bottom" tabs={tabs.tabs} activeId={tabs.activeTabId} showTabNumbers={tabNumbers} fixedWidthTabs={fixedWidth}
      onSelect={tabs.selectTab} onClose={closeTab} onNew={tabs.newTab} onNewPowerShell={tabs.newPowerShellTab} onReorder={tabs.reorderTabs}
      onMoveTab={(id, receive) => tabs.moveTab(id, receive, id === activeTabId ? scrollTop.current ?? undefined : undefined)}
      onReceiveTab={(transfer, index) => {
        if (activeTabId && scrollTop.current !== null) setTabScrollTop(activeTabId, scrollTop.current);
        if (!tabs.receiveTab(transfer, index)) return false;
        setBottomPaneActive(true);
        focusFiles();
        return true;
      }}
      onOpenLocation={openLocationTab}
      onStripContextMenu={menu.openActionMenu}
      onTabContextMenu={paneActions.handlePlaceTargetContextMenu}
      onTabContextMenuDown={paneActions.handlePlaceTargetContextMenuDown}
      dropTargetId={drop.dropTargetTabId} dropTargetPath={drop.dropTargetPath} tabDropSubmenu={drop.tabDropSubmenu}
      dragPoint={drop.dragPoint} onSubmenuHoverTargetChange={drop.setDropTarget} onSubmenuCloseRequest={drop.clearDragState} />
    {terminal ? <TerminalDirectoryBar directory={terminal.directory} /> : showBreadcrumbs ? (
      <PathCrumbsBar pane="bottom" path={tabs.displayPath} trailPath={tabs.activeTab?.crumbTrailPath} reserveSpace
        dropTargetPath={drop.hoveredPane === "bottom" ? drop.dropTargetPath : null}
        onNavigate={browseFromView} onNavigateNewTab={openLocationTab}
        onCrumbContextMenu={paneActions.handlePlaceTargetContextMenu}
        onCrumbContextMenuDown={paneActions.handlePlaceTargetContextMenuDown} />
    ) : null}
    <TerminalSplitView pane="bottom" tab={tabs.activeTab} filePaneRef={files} onSelectTab={tabs.selectTab} commandsBlocked={commandsBlocked}>
    <div ref={files} className="main bottom-files" tabIndex={-1} aria-busy={busy} data-file-pane="bottom" data-pane-path={ready ? path : ""}
      data-drop-background={drop.backgroundHovered && drop.hoveredPane === "bottom" || undefined}
      onScrollCapture={event => {
        const el = event.target as HTMLElement;
        if (el.matches(".list-body,.thumb-viewport")) scrollTop.current = el.scrollTop;
      }}>
      {busy && <div className="folder-load-progress" role="progressbar" aria-label="Loading bottom folder" />}
      {terminal ? <TerminalPane terminal={terminal} /> : !ready && tabs.displayPath ? <div className="pane-loading">{busy ? "Loading folder…" : <button className="btn ghost" type="button" onClick={() => navigate(tabs.displayPath)}>Retry opening folder</button>}</div> :
      <FileView {...upper} {...model} pane="bottom" dropTargetPath={drop.hoveredPane === "bottom" ? drop.dropTargetPath : null} currentPath={path} viewMode={tabs.viewMode} viewKey={viewKey}
        showLander={!path} recentJumps={tabs.recentJumps} onOpenPlace={navigate} onOpenRecent={navigate} onOpenDrive={navigate}
        onOpenDriveNewTab={openNew} onOpenPlaceNewTab={openNew} onOpenRecentNewTab={openNew}
        searchQuery={tabs.searchValue} loading={busy} scrollRestoreKey={viewKey}
        scrollRestoreTop={tabs.navigationRevealPath ? 0 : tabs.activeTab?.scrollTop ?? 0}
        scrollRequest={scrollRequest} selectedPaths={selection.selected} onSelectItem={paneActions.handleSelectItemWithRename}
        onSetSelection={paneActions.handleSelectionChange} onClearSelection={paneActions.handleClearSelection}
        onOpenDir={browseFromView} onOpenDirNewTab={openNew} onGoUp={() => dir.parentPath && navigate(dir.parentPath)} canGoUp={!!dir.parentPath}
        sortState={tabs.sortState} onSortChange={paneActions.changeSort}
        entryMeta={meta.entryMeta} onRequestMeta={meta.requestEntryMeta} onStartDragOut={dragOut}
        onCreateFile={paneActions.createFile} onCreateFolder={paneActions.createFolder}
        onCreateFolderAndGo={paneActions.createFolderAndGo}
        renameTargetPath={paneActions.renameTarget?.path} renameValue={paneActions.renameValue}
        onRenameChange={paneActions.setRenameValue} onRenameCommit={paneActions.handleRenameCommit}
        onRenameCancel={paneActions.handleRenameCancel}
        onEntryContextMenu={paneActions.handleEntryContextMenu} onEntryContextMenuDown={paneActions.handleEntryContextMenuDown}
        onContextMenu={ready ? paneActions.handleLayoutContextMenu : undefined}
        onContextMenuDown={ready ? paneActions.handleLayoutContextMenuDown : undefined}
        onEntryPreviewPress={bottomPreview.onPress} onEntryPreviewRelease={upper.onEntryPreviewRelease}
        onGridColumnsChange={updateGridColumns}
      />}
    </div>
    </TerminalSplitView>
    {createPortal(<ContextMenu
      open={paneActions.contextMenuOpen}
      x={menu.contextMenu?.x ?? 0}
      y={menu.contextMenu?.y ?? 0}
      items={paneActions.contextMenuItems}
      focusFirstItem={menu.contextMenu?.focusFirstItem}
      scrollable={menu.contextMenu?.kind === "place-target" ||
        (menu.contextMenu?.kind === "actions" && menu.contextMenu.scrollable)}
      onClose={menu.closeContextMenu}
      onOpenNative={() => paneActions.openKeyboardContextMenu(true)}
    />, document.body)}
  </section>;
}
