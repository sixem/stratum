// Secondary workspace with its own tabs, navigation, and file selection.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, PointerEvent } from "react";
import type { ShellMenuTarget } from "@/api";
import { useDriveInfo } from "@/hooks/domain/filesystem/useDriveInfo";
import { useStatusLabels } from "@/hooks/domain/metadata/useStatusLabels";
import { FileView } from "../FileView";
import { TabsBar } from "@/components/navigation/TabsBar";
import { ChevronDownIcon, ChevronUpIcon, GridIcon, ListIcon, NavArrowIcon, TabCloseIcon } from "@/components/icons";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { useDragOutHandler } from "@/hooks/ui/inputs/useDragOutHandler";
import { useWindowsContextMenu } from "@/hooks/ui/menus/useWindowsContextMenu";
import type { PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import { useSettingsStore, refreshFileClipboard } from "@/modules";
import { hideBottomPane, setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { folderPathKey, getNextTrailPath, isPreviewableEntry } from "@/lib";
import type { useFileManager } from "@/hooks/domain/filesystem/useFileManager";
import type { useFileDrop } from "@/hooks/domain/filesystem/useFileDrop";
import { bottomPaneKeys } from "./bottomPaneKeys";
import { useBottomFolder } from "./useBottomFolder";

export type PaneActions = ReturnType<typeof useFileManager>;
export type PaneDrop = ReturnType<typeof useFileDrop>;
export type PaneSummary = {
  path: string;
  recentJumps: string[];
  countLabel: string;
  selectionLabel: string;
};
type Props = {
  upper: ComponentProps<typeof FileView>;
  actions: PaneActions;
  drop: PaneDrop;
  onSummary: (summary: PaneSummary) => void;
  onOpenGallery: (path: string, source: PreviewGallerySource) => void;
};

export function BottomPane({ upper, actions, drop, onSummary, onOpenGallery }: Props) {
  const folder = useBottomFolder(upper.currentPath);
  const { dir, meta, tabs, model, selection, viewKey, busy } = folder;
  const root = useRef<HTMLElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(tabs.displayPath);
  const [rename, setRename] = useState<{ path: string; name: string } | null>(null);
  const [scrollRequest, setScrollRequest] = useState<{index: number; nonce: number} | null>(null);
  const tabNumbers = useSettingsStore(state => state.showTabNumbers);
  const fixedWidth = useSettingsStore(state => state.fixedWidthTabs);
  const path = dir.currentPath;
  const { currentDriveInfo } = useDriveInfo({
    currentPath: path, drives: upper.drives, driveInfo: upper.driveInfo,
  });
  const { countLabel, selectionLabel } = useStatusLabels({
    isFiltered: !!tabs.searchValue.trim(), visibleCount: dir.entries.length, totalCount: dir.totalCount,
    currentDriveInfo, selected: selection.selected, entryMeta: meta.entryMeta,
  });
  useLayoutEffect(() => {
    onSummary({ path, recentJumps: tabs.recentJumps, countLabel, selectionLabel });
  }, [onSummary, path, tabs.recentJumps, countLabel, selectionLabel]);
  const ready = !!path && !busy && folderPathKey(path) === folderPathKey(tabs.activeTab?.path ?? "");
  const viewVisit = useMemo(() => ({ current: false }), [viewKey]);
  useLayoutEffect(() => {
    viewVisit.current = ready;
    return () => { viewVisit.current = false; };
  }, [ready, viewVisit]);
  const nextTrailPath = ready ? getNextTrailPath(path, tabs.activeTab?.crumbTrailPath) : null;
  const paths = useMemo(() => Array.from(selection.selected).filter(item => model.entryByPath.has(item)),
    [selection.selected, model.entryByPath]);
  useLayoutEffect(() => setDraft(tabs.displayPath), [tabs.displayPath, tabs.activeTabId]);
  useEffect(() => { setRename(null); setScrollRequest(null); }, [viewKey]);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  // A sidebar jump belongs to the pane it opened. Its next keyboard action
  // should operate on the new folder even when the sidebar button took focus.
  useLayoutEffect(() => {
    if (folder.navigation) root.current?.focus({ preventScroll: true });
  }, [folder.navigation]);
  const scrollTop = useRef<number | null>(null);
  const { activeTabId, setTabScrollTop } = tabs;
  useLayoutEffect(() => {
    scrollTop.current = null;
    return () => {
      if (activeTabId && scrollTop.current !== null) setTabScrollTop(activeTabId, scrollTop.current);
    };
  }, [activeTabId, setTabScrollTop]);
  const navigate = (next: string) => { if (next.trim()) tabs.browseTo(next.trim()); };
  const openNew = tabs.openInNewTab;
  const dragOut = useDragOutHandler({
    beginFileActivity: actions.beginFileActivity, viewParentPath: dir.parentPath, onRefresh: dir.refreshAfterChange,
  });
  const nativeMenu = useWindowsContextMenu({
    enabled: "__TAURI_INTERNALS__" in window, closeContextMenu: () => {},
    beginFileActivity: actions.beginFileActivity,
    onCommand: () => { void refreshFileClipboard().catch(() => {}); void dir.refreshAfterChange(); },
  });
  const galleryAction = (targetPath?: string) => {
    const entry = targetPath ? model.entryByPath.get(targetPath) : undefined;
    if (!entry || !isPreviewableEntry(entry)) return;
    return () => {
      if (!viewVisit.current) return;
      onOpenGallery(entry.path, {
        items: dir.entries,
        entryByPath: model.entryByPath,
        onSelectPath: (selectedPath) => {
          if (viewVisit.current) selection.setSelection([selectedPath], selectedPath);
        },
      });
    };
  };
  const openKeyboardMenu = (target: ShellMenuTarget, point: { x: number; y: number }) =>
    nativeMenu(target, point, false, galleryAction("paths" in target ? target.paths[0] : undefined));
  const openMenu = (event: PointerEvent, entry?: {path: string}) => {
    event.preventDefault(); event.stopPropagation();
    if (!ready) return;
    const targets = entry && (paths.includes(entry.path) ? paths : [entry.path]);
    if (entry && !paths.includes(entry.path)) selection.setSelection([entry.path]);
    nativeMenu(targets ? { paths: targets } : { backgroundPath: path },
      { x: event.clientX, y: event.clientY }, event.shiftKey, galleryAction(entry?.path));
  };
  const onKey = bottomPaneKeys({
    folder, actions, address, nativeMenu: openKeyboardMenu, paths, ready, startRename: setRename,
    scrollTo: index => setScrollRequest(prev => ({ index, nonce: (prev?.nonce ?? 0) + 1 })),
  });
  const nextView = tabs.viewMode === "list" ? "thumbs" : "list";
  const viewSwitchLabel = nextView === "thumbs" ? "Switch to thumbnails" : "Switch to list";

  return <section ref={root} className="bottom-pane" aria-label="Bottom pane" tabIndex={-1}
    onKeyDown={onKey} onFocusCapture={() => setBottomPaneActive(true)}
    onPointerDownCapture={event => {
      setBottomPaneActive(true);
      if (!(event.target as Element).closest("button, input, [tabindex='0']"))
        root.current?.focus({preventScroll:true});
    }}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    <nav className="bottom-nav" aria-label="Bottom pane navigation">
      <ToolbarIconButton
        label="Back"
        ariaLabel="Bottom pane back"
        disabled={!tabs.canGoBack}
        onClick={tabs.goBack}
        pressOnPointerDown={false}
      >
        <NavArrowIcon className="nav-arrow is-back" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Forward"
        ariaLabel="Bottom pane forward"
        disabled={!tabs.canGoForward}
        onClick={tabs.goForward}
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
      <form onSubmit={event => { event.preventDefault(); navigate(draft); root.current?.focus(); }}>
        <input ref={address} aria-label="Bottom pane folder" value={draft} placeholder="Folder path" onChange={event => setDraft(event.target.value)} />
      </form>
      <ToolbarIconButton
        label={viewSwitchLabel}
        onClick={() => {
          // With no tab, keep the chosen layout for the next folder opened here.
          if (tabs.activeTab) tabs.setViewMode(nextView);
          else useBottomPaneStore.setState({ defaultViewMode: nextView });
        }}
        pressOnPointerDown={false}
      >
        {nextView === "thumbs" ? <GridIcon /> : <ListIcon />}
      </ToolbarIconButton>
      <ToolbarIconButton label="Hide bottom pane" onClick={hideBottomPane} pressOnPointerDown={false}>
        <TabCloseIcon />
      </ToolbarIconButton>
    </nav>
    <TabsBar tabs={tabs.tabs} activeId={tabs.activeTabId} showTabNumbers={tabNumbers} fixedWidthTabs={fixedWidth}
      onSelect={tabs.selectTab} onClose={tabs.closeTab} onNew={tabs.newTab} onReorder={tabs.reorderTabs}
      dropTargetId={drop.dropTargetTabId} dropTargetPath={drop.dropTargetPath} tabDropSubmenu={drop.tabDropSubmenu}
      dragPoint={drop.dragPoint} onSubmenuHoverTargetChange={drop.setDropTarget} onSubmenuCloseRequest={drop.clearDragState} />
    <div className="main bottom-files" tabIndex={-1} aria-busy={busy} data-file-pane="bottom" data-pane-path={ready ? path : ""}
      data-drop-background={drop.backgroundHovered && drop.hoveredPane === "bottom" || undefined}
      onScrollCapture={event => {
        const el = event.target as HTMLElement;
        if (el.matches(".list-body,.thumb-viewport")) scrollTop.current = el.scrollTop;
      }}>
      {busy && <div className="folder-load-progress" role="progressbar" aria-label="Loading bottom folder" />}
      {!ready && tabs.displayPath ? <div className="pane-loading">{busy ? "Loading folder…" : <button onClick={() => navigate(tabs.displayPath)}>Retry opening folder</button>}</div> :
      <FileView {...upper} {...model} dropTargetPath={drop.hoveredPane === "bottom" ? drop.dropTargetPath : null} currentPath={path} viewMode={tabs.viewMode} viewKey={viewKey}
        showLander={!path} recentJumps={tabs.recentJumps} onOpenPlace={navigate} onOpenRecent={navigate} onOpenDrive={navigate}
        onOpenDriveNewTab={openNew} onOpenPlaceNewTab={openNew} onOpenRecentNewTab={openNew}
        searchQuery={tabs.searchValue} loading={busy} scrollRestoreKey={viewKey} scrollRestoreTop={tabs.activeTab?.scrollTop ?? 0}
        scrollRequest={scrollRequest} selectedPaths={selection.selected} onSelectItem={selection.selectItem}
        onSetSelection={selection.setSelection} onClearSelection={selection.clearSelection}
        onOpenDir={navigate} onOpenDirNewTab={openNew} onGoUp={() => dir.parentPath && navigate(dir.parentPath)} canGoUp={!!dir.parentPath}
        sortState={tabs.sortState} onSortChange={sort => { tabs.setSort(sort); void dir.loadDir(path, {sort}); }}
        entryMeta={meta.entryMeta} onRequestMeta={meta.requestEntryMeta} onStartDragOut={dragOut}
        onCreateFile={actions.createFile} onCreateFolder={actions.createFolder}
        onCreateFolderAndGo={async (parent, name) => { const created = await actions.createFolder(parent,name); if(created) navigate(created); }}
        renameTargetPath={rename?.path} renameValue={rename?.name ?? ""} onRenameChange={name => setRename(prev => prev && {...prev, name})}
        onRenameCommit={() => { if(rename) void actions.renameEntry(rename.path, rename.name); setRename(null); }} onRenameCancel={() => setRename(null)}
        onEntryContextMenu={openMenu} onContextMenu={openMenu} onContextMenuDown={undefined} onEntryContextMenuDown={undefined}
        onEntryPreviewPress={undefined} onEntryPreviewRelease={undefined} onGridColumnsChange={undefined}
      />}
    </div>
  </section>;
}
