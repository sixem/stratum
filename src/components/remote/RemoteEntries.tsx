// Adapt an SFTP listing to the explorer's regular list and grid.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { FileGrid, FileList } from "../explorer/folderRenderers";
import { ContextMenu } from "../overlay/ContextMenu";
import { buildEntryItems } from "@/lib/entryItems";
import { useTypeaheadSelection } from "@/hooks/ui/selection/useTypeaheadSelection";
import { useSelection } from "@/hooks/ui/selection/useSelection";
import { moveFileSelection } from "@/hooks/ui/selection/moveFileSelection";
import { useScrollRequest } from "@/hooks/perf/scroll/useScrollRequest";
import { buildKeybindFromEvent } from "@/modules/keybinds";
import { resizeThumbnails } from "@/modules/resizeThumbnails";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useSettingsStore } from "@/modules/settings.store";
import type { PanePreviewBindings, PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import type { LinkedPane } from "@/lib/paneLink";
import type { SortState, ViewMode } from "@/types";
import { isPreviewableEntry } from "@/lib/fileKind";
import { openRemoteFile } from "./remoteOpen";
import { canBrowseEntry, remoteParent, type RemoteEntry } from "./remoteDirectory";
import { useRemoteThumbnails } from "./useRemoteThumbnails";

type Props = {
  preview: PanePreviewBindings; onPreviewRelease?: (path: string) => boolean;
  entries: RemoteEntry[]; pane: LinkedPane; path: string; search: string;
  hostId: string; sessionId: number; viewMode: ViewMode; sort: SortState;
  onSelection: (selected: Set<string>) => void;
  onSort: (sort: SortState) => void;
  onNavigate: (path: string) => void;
  onOpenTab: (path: string) => void;
  scrollTop?: number;
  onScrollTop?: (top: number) => void;
};

const emptyPaths = new Set<string>();
const emptyPreviews = new Map<string, string>();
const noop = () => {};
const listingMetadata = async () => [];
const rename = { renameValue: "", onRenameChange: noop, onRenameCommit: noop, onRenameCancel: noop };

export function RemoteEntries(props: Props) {
  const { entries, path, hostId, sessionId, onSelection } = props;
  const settings = useSettingsStore();
  const parent = settings.showParentEntry && !props.search.trim() && entries.length > 0 && path !== "/" ? remoteParent(path) : null;
  const items = useMemo(() => buildEntryItems(entries, parent), [entries, parent]);
  const paths = useMemo(() => items.map(item => item.type === "parent" ? item.path : item.entry.path), [items]);
  const entryByPath = useMemo(() => new Map(entries.map(entry => [entry.path, entry])), [entries]);
  const key = JSON.stringify([hostId, sessionId, path]);
  const container = useRef<HTMLDivElement>(null);
  const selection = useSelection({ items: paths, resetKey: key });
  useLayoutEffect(() => { onSelection(selection.selected); }, [onSelection, selection.selected]);
  const gallery = useMemo<PreviewGallerySource>(() => ({
    remote: { profileId: hostId, sessionId }, items: entries, entryByPath,
    onSelectPath: path => selection.setSelection([path], path),
  }), [hostId, sessionId, entries, entryByPath, selection.setSelection]);
  const register = props.preview.registerSource;
  const getSelectionSnapshot = selection.getSelectionSnapshot;
  useLayoutEffect(() => {
    const root = container.current;
    const paneRoot = root?.closest<HTMLElement>('[data-file-pane]');
    if (!root || !paneRoot) return;
    return register({ getGallery: () => gallery, paneRoot, filesRoot: paneRoot,
      isCurrent: () => root.isConnected, getSelectionSnapshot });
  }, [gallery, register, getSelectionSnapshot]);
  const [visible, setVisible] = useState<RemoteEntry[]>([]);
  const preview = useRemoteThumbnails(hostId, sessionId, visible, props.viewMode === "thumbs" && settings.remoteThumbnails);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const columns = useRef(1);
  const { scrollRequest, requestScrollToIndex } = useScrollRequest();
  const handleTypeahead = useTypeaheadSelection({
    items,
    resetKeys: [key, props.search, props.viewMode],
    onMatch: item => {
      selection.setSelection([item.path], item.path);
      requestScrollToIndex(item.index, undefined, props.viewMode === "list" ? "center" : "nearest");
      container.current?.focus({ preventScroll: true });
    },
  });
  useEffect(() => {
    const onWindowKey = (event: globalThis.KeyboardEvent) => {
      const active = document.activeElement;
      if (container.current?.contains(active)) return;
      const bottomActive = useBottomPaneStore.getState().active;
      if ((props.pane === "bottom") !== bottomActive) return;
      if (active && active !== document.body && active !== document.documentElement &&
          !active.closest(props.pane === "main" ? ".topstack" : ".bottom-pane")) return;
      if (Array.from(document.querySelectorAll('[role="dialog"], .context-menu[data-open="true"]')).some(element => !element.closest("[inert]") && element.getClientRects().length > 0)) return;
      if (handleTypeahead(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onWindowKey, true);
    return () => window.removeEventListener("keydown", onWindowKey, true);
  }, [handleTypeahead, props.pane]);
  const browsable = (target: string) => target === parent || !!entryByPath.get(target) && canBrowseEntry(entryByPath.get(target)!);
  const showMenu = (event: PointerEvent, target: { path: string }) => {
    if (target.path !== parent && !entryByPath.has(target.path)) return;
    selection.setSelection([target.path]);
    setMenu({ path: target.path, x: event.clientX, y: event.clientY });
  };
  const openFile = (target: string) => {
    const entry = entryByPath.get(target);
    if (!entry || entry.isDir || entry.isSymlink) return;
    const canPreview = isPreviewableEntry(entry, settings.galleryAudio);
    openRemoteFile(hostId, sessionId, target, canPreview ? () => props.preview.open(target) : undefined);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const current = selection.getAnchorPath();
    const index = current ? paths.indexOf(current) : -1;
    if (moveFileSelection(e.nativeEvent, props.viewMode, columns.current, paths, index, selection.selectItem, requestScrollToIndex)) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    const binding = buildKeybindFromEvent(e.nativeEvent);
    if (props.viewMode === "thumbs" && (binding === settings.keybinds.increaseThumbnailSize ||
        binding === settings.keybinds.decreaseThumbnailSize)) {
      const store = getPaneSessionStore(props.pane);
      resizeThumbnails(binding === settings.keybinds.increaseThumbnailSize ? 1 : -1, store, store.getState().activeTabId);
    } else if (e.key === "Home" || e.key === "End") {
      const next = e.key === "Home" ? 0 : paths.length - 1;
      if (!paths[next]) return;
      selection.selectItem(paths[next], next, e);
      requestScrollToIndex(next);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      selection.setSelection(entries.map(entry => entry.path));
    } else if (e.key === "Enter" && current) {
      if (browsable(current)) (e.ctrlKey || e.metaKey ? props.onOpenTab : props.onNavigate)(current);
      else openFile(current);
    } else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && current && (browsable(current) || entryByPath.has(current))) {
      const box = container.current?.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
      if (box) setMenu({ path: current, x: box.left + 12, y: box.top + 12 });
    } else if (handleTypeahead(e.nativeEvent)) {
      e.preventDefault(); e.stopPropagation(); return;
    } else if (e.key === "Backspace" && path !== "/") {
      props.onNavigate(remoteParent(path));
    } else if (e.key === "Escape") {
      selection.clearSelection();
    } else return;
    e.preventDefault(); e.stopPropagation();
  };
  const common = {
    view: { remote: true, currentPath: path, entryByPath, items, loading: false, searchQuery: props.search,
      viewKey: key, scrollRestoreKey: key, scrollRestoreTop: props.scrollTop ?? 0, scrollRequest,
      smoothScroll: settings.smoothScroll, canGoUp: path !== "/", onGoUp: () => props.onNavigate(remoteParent(path)) },
    selection: { selectedPaths: selection.selected, pendingDeletePaths: emptyPaths, pendingTransferPaths: emptyPaths,
      onSelectItem: selection.selectItem, onSetSelection: selection.setSelection, onClearSelection: selection.clearSelection },
    navigation: { canBrowseEntry: browsable, onOpenDir: props.onNavigate, onOpenDirNewTab: props.onOpenTab,
      onOpenEntry: (path: string) => { if (browsable(path)) props.onNavigate(path); else openFile(path); } },
    metadata: { entryMeta: entryByPath, onRequestMeta: listingMetadata }, rename,
    contextMenu: { onEntryContextMenu: showMenu }, preview: { onEntryPreviewPress: props.preview.onPress, onEntryPreviewRelease: props.onPreviewRelease }, dragDrop: {},
  };
  return <div className="remote-entries" ref={container} tabIndex={-1} onKeyDown={onKeyDown}
    onScrollCapture={e => { if ((e.target as Element).matches(".list-body, .thumb-viewport")) props.onScrollTop?.((e.target as HTMLElement).scrollTop); }}>
    <Suspense fallback={null}>{props.viewMode === "list"
      ? <FileList {...common} list={{ sortState: props.sort, onSortChange: props.onSort, categoryTinting: settings.categoryTinting,
          nameEllipsis: settings.gridNameEllipsis, hideExtension: settings.gridNameHideExtension }} />
      : <FileGrid {...common} grid={{ pane: props.pane, gridSize: settings.gridSize, gridAutoColumns: settings.gridAutoColumns,
          gridGap: settings.gridGap, gridShowSize: settings.gridShowSize, gridShowExtension: settings.gridShowExtension,
          gridNameEllipsis: settings.gridNameEllipsis, gridNameHideExtension: settings.gridNameHideExtension,
          onGridColumnsChange: n => { columns.current = n; } }}
          thumbs={{ thumbnailsEnabled: false, thumbnails: emptyPreviews, onRequestThumbs: noop,
            onVisibleEntries: settings.remoteThumbnails ? setVisible : undefined, externalPreview: entry => preview(entry) || undefined,
            thumbnailFit: settings.thumbnailFit, thumbnailAppIcons: settings.thumbnailAppIcons, thumbnailFolders: false, thumbnailVideos: false,
            thumbnailSvgs: false, categoryTinting: settings.categoryTinting }} />}</Suspense>
    <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} scrollContainer={container}
      onClose={() => setMenu(null)} items={menu ? browsable(menu.path) ? [
        { id: "open", icon: "open-folder", label: "Open folder", onSelect: () => props.onNavigate(menu.path) },
        { id: "open-new-tab", icon: "open-new-tab", label: "Open in new tab", onSelect: () => props.onOpenTab(menu.path) },
      ] : [
        { id: "open", icon: "open", label: "Open", onSelect: () => openFile(menu.path) },
        ...(isPreviewableEntry(entryByPath.get(menu.path)!, settings.galleryAudio)
          ? [{ id: "gallery", icon: "open-gallery" as const, label: "Open in gallery", onSelect: () => props.preview.open(menu.path) }] : []),
      ] : []} />
  </div>;
}
