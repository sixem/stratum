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
import { isCurrentPaneDirectory, useOtherPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import type { PanePreviewBindings, PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import type { LinkedPane } from "@/lib/paneLink";
import type { SortState, ViewMode } from "@/types";
import { isPreviewableEntry } from "@/lib/fileKind";
import { isEditableElement } from "@/lib";
import { openRemoteFile } from "./remoteOpen";
import { copyRemoteFiles } from "@/modules/remoteTransfer";
import { canBrowseEntry, remoteParent, type RemoteEntry } from "./remoteDirectory";
import { useRemoteThumbnails } from "./useRemoteThumbnails";
import { useRemoteEntryDrag } from "./useRemoteEntryDrag";
import { useRemoteDrag } from "@/modules/remoteDrag";
import { resolveRemoteLink, useRemoteLinks } from "./useRemoteLinks";
import { usePromptStore } from "@/modules/promptStore";
import { useCreateEntryPrompt } from "@/hooks/ui/app/useCreateEntryPrompt";
import { useLayoutMenuItems } from "@/hooks/ui/menus/useLayoutMenuItems";
import { buildEntryOpenItems } from "@/hooks/ui/menus/entryMenu/buildEntryOpenItems";
import { buildEntryRenameItems } from "@/hooks/ui/menus/entryMenu/buildEntryRenameItems";
import type { ContextMenuItem } from "@/types";
import { useRemoteOperations } from "./useRemoteOperations";
import { moveRemoteEntries } from "./remoteMove";
import { useClipboardStore, writeRemoteClipboard } from "@/modules/clipboardStore";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { pasteIntoRemote } from "@/modules/remoteClipboard";
import { remoteSelectionCache } from "./remoteViewCache";

type Props = {
  preview: PanePreviewBindings; onPreviewRelease?: (path: string) => boolean;
  entries: RemoteEntry[]; pane: LinkedPane; path: string; search: string;
  hostId: string; sessionId: number; viewMode: ViewMode; sort: SortState;
  sessionEpoch: number;
  tabId: string;
  directoryPath: string;
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

export function RemoteEntries(props: Props) {
  const { path, hostId, sessionId, onSelection } = props;
  const [visible, setVisible] = useState<RemoteEntry[]>([]);
  const entries = useRemoteLinks(props.entries, visible, hostId, sessionId);
  const hoveredDrop = useRemoteDrag(state => state.remoteTarget?.pane === props.pane && state.remoteTarget.kind === "remote-entry" ? state.remoteTarget.path : null);
  const settings = useSettingsStore();
  const canPaste = useClipboardStore(state => Boolean(state.remote?.entries.length || state.clipboard?.paths.length));
  const otherPane = useOtherPaneDirectory(props.pane);
  const parent = settings.showParentEntry && !props.search.trim() && entries.length > 0 && path !== "/" ? remoteParent(path) : null;
  const items = useMemo(() => buildEntryItems(entries, parent), [entries, parent]);
  const paths = useMemo(() => items.map(item => item.type === "parent" ? item.path : item.entry.path), [items]);
  const entryByPath = useMemo(() => new Map(entries.map(entry => [entry.path, entry])), [entries]);
  const startDrag = useRemoteEntryDrag(props.pane, hostId, sessionId, props.directoryPath, entryByPath);
  const key = JSON.stringify([hostId, sessionId, path]);
  const selectionKey = JSON.stringify([props.tabId, hostId, sessionId, props.sessionEpoch, props.directoryPath]);
  const container = useRef<HTMLDivElement>(null);
  const selection = useSelection({ items: paths, resetKey: key });
  // Restore once on entry; the shared selection hook prunes missing paths on refresh.
  useLayoutEffect(() => {
    const saved = remoteSelectionCache.get(selectionKey);
    if (saved) selection.setSelection(saved.paths, saved.anchor ?? undefined);
  }, [selectionKey]);
  useLayoutEffect(() => () => {
    const snapshot = [...selection.getSelectionSnapshot()];
    const estimatedBytes = snapshot.reduce((bytes, path) => bytes + 64 + path.length * 2, 64);
    remoteSelectionCache.set(selectionKey, { paths: snapshot, anchor: selection.getAnchorPath() }, estimatedBytes);
  }, [selectionKey, selection.getSelectionSnapshot, selection.getAnchorPath]);
  const copySelection = (selectedPaths: string[]) => {
    const host = useRemoteHosts.getState().profiles.find(profile => profile.id === hostId);
    const selectedEntries = selectedPaths.flatMap(path => entryByPath.has(path) ? [entryByPath.get(path)!] : []);
    if (host && selectedEntries.length) void writeRemoteClipboard({ profileId: hostId, host: host.destination, path: props.directoryPath, entries: selectedEntries });
  };
  const paste = (destination = props.directoryPath) => {
    void pasteIntoRemote({ profileId: hostId, sessionId, path: destination }).catch(error =>
      usePromptStore.getState().showPrompt({ title: "Paste failed", content: String(error), confirmLabel: "OK", cancelLabel: null }));
  };
  const ops = useRemoteOperations(hostId, sessionId, props.directoryPath, selection.clearSelection, props.pane);
  const createPrompt = useCreateEntryPrompt();
  const createFolderAndOpen = async (folder: string, name: string) => {
    if (await ops.create(folder, name, true)) props.onNavigate(`${folder.replace(/\/$/, "")}/${name}`);
  };
  const backgroundMenu = useLayoutMenuItems({ currentPath: props.directoryPath, sortState: props.sort,
    onSortChange: props.onSort, onPaste: paste, onCreateFolder: (folder, name) => ops.create(folder, name, true),
    onCreateFolderAndGo: createFolderAndOpen, onCreateFile: (folder, name) => ops.create(folder, name, false), preserveWhitespace: true,
    shellAvailability: null, menuOpenPwsh: false, menuOpenWsl: false, onOpenShell: noop });
  useLayoutEffect(() => { onSelection(selection.selected); }, [onSelection, selection.selected]);
  const gallery = useMemo<PreviewGallerySource>(() => ({
    remote: { profileId: hostId, sessionId }, items: entries.filter(entry => !entry.isSymlink), entryByPath,
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
  const preview = useRemoteThumbnails(hostId, sessionId, visible, props.viewMode === "thumbs" && settings.remoteThumbnails,
    props.viewMode === "thumbs" && settings.remoteVideoThumbnails);
  const [menu, setMenu] = useState<{ path?: string; x: number; y: number } | null>(null);

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
      if (event.defaultPrevented || event.isComposing || isEditableElement(active)) return;
      const bottomActive = useBottomPaneStore.getState().active;
      if ((props.pane === "bottom") !== bottomActive) return;
      if (active && active !== document.body && active !== document.documentElement &&
          !active.closest(props.pane === "main" ? ".topstack" : ".bottom-pane")) return;
      if (Array.from(document.querySelectorAll('[role="dialog"], .context-menu[data-open="true"]')).some(element => !element.closest("[inert]") && element.getClientRects().length > 0)) return;
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c" && selection.selected.size) {
        copySelection([...selection.selected]); event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v") {
        paste(); event.preventDefault(); event.stopPropagation(); return;
      }
      if (!event.repeat && buildKeybindFromEvent(event) === settings.keybinds.deleteSelection && selection.selected.size) {
        ops.deleteEntries([...selection.selected].flatMap(path => entryByPath.get(path) ? [entryByPath.get(path)!] : []));
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (handleTypeahead(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onWindowKey, true);
    return () => window.removeEventListener("keydown", onWindowKey, true);
  }, [handleTypeahead, props.pane, selection.selected, entryByPath, hostId, sessionId, props.directoryPath, settings.keybinds.deleteSelection, ops.deleteEntries]);
  const browsable = (target: string) => target === parent || !!entryByPath.get(target) && canBrowseEntry(entryByPath.get(target)!);
  const showMenu = (event: PointerEvent, target: { path: string }) => {
    if (target.path !== parent && !entryByPath.has(target.path)) return;
    if (!selection.selected.has(target.path)) selection.setSelection([target.path]);
    setMenu({ path: target.path, x: event.clientX, y: event.clientY });
  };
  const openFile = (target: string) => {
    const entry = entryByPath.get(target);
    if (!entry || entry.isDir) return;
    if (entry.isSymlink) {
      void resolveRemoteLink(hostId, sessionId, target).then(result => {
        if (result.kind === "directory") props.onNavigate(target);
        else openRemoteFile(hostId, sessionId, result.path);
      }).catch(error => usePromptStore.getState().showPrompt({ title: "Could not open symbolic link", content: String(error) }));
      return;
    }
    const canPreview = isPreviewableEntry(entry, settings.galleryAudio);
    openRemoteFile(hostId, sessionId, target, canPreview ? () => props.preview.open(target) : undefined);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    const current = selection.getAnchorPath();
    const index = current ? paths.indexOf(current) : -1;
    if (moveFileSelection(e.nativeEvent, props.viewMode, columns.current, paths, index, selection.selectItem, requestScrollToIndex)) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    const binding = buildKeybindFromEvent(e.nativeEvent);
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c" && selection.selected.size) {
      copySelection([...selection.selected]);
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "v") {
      paste();
    } else if (binding === settings.keybinds.renameSelection && current && selection.selected.size && entryByPath.has(current)) {
      if (selection.selected.size === 1) ops.startRename(entryByPath.get(current)!);
      else ops.startBatchRename(entries.filter(entry => selection.selected.has(entry.path)));
    } else if (binding === settings.keybinds.deleteSelection && selection.selected.size) {
      ops.deleteEntries([...selection.selected].flatMap(path => entryByPath.get(path) ? [entryByPath.get(path)!] : []));
    } else if (props.viewMode === "thumbs" && (binding === settings.keybinds.increaseThumbnailSize ||
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
    view: { remote: true, currentPath: props.directoryPath, entryByPath, items, loading: false, searchQuery: props.search,
      viewKey: key, scrollRestoreKey: key, scrollRestoreTop: props.scrollTop ?? 0, scrollRequest,
      smoothScroll: settings.smoothScroll, canGoUp: path !== "/", onGoUp: () => props.onNavigate(remoteParent(path)) },
    selection: { selectedPaths: selection.selected, pendingDeletePaths: emptyPaths, pendingTransferPaths: emptyPaths,
      onSelectItem: selection.selectItem, onSetSelection: selection.setSelection, onClearSelection: selection.clearSelection },
    navigation: { canBrowseEntry: browsable, onOpenDir: props.onNavigate, onOpenDirNewTab: props.onOpenTab,
      onOpenEntry: (path: string) => { if (browsable(path)) props.onNavigate(path); else openFile(path); } },
    metadata: { entryMeta: entryByPath, onRequestMeta: listingMetadata },
    rename: { renameTargetPath: ops.target?.path, renameValue: ops.value, onRenameChange: ops.setValue,
      onRenameCommit: ops.commitRename, onRenameCancel: ops.cancelRename },
    contextMenu: { onEntryContextMenu: showMenu,
      onContextMenuDown: (event: PointerEvent) => event.preventDefault(),
      onContextMenu: (event: PointerEvent) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); } },
    preview: { onEntryPreviewPress: (path: string) => entryByPath.get(path)?.isSymlink ? false : props.preview.onPress(path), onEntryPreviewRelease: props.onPreviewRelease },
    dragDrop: { onStartDragOut: startDrag, dropTargetPath: hoveredDrop },
    creation: { preserveWhitespace: true, onCreateFolder: (folder: string, name: string) => ops.create(folder, name, true),
      onCreateFolderAndGo: createFolderAndOpen, onCreateFile: (folder: string, name: string) => ops.create(folder, name, false) },
  };
  const menuPath = menu?.path;
  const menuPaths = menuPath && selection.selected.has(menuPath) ? [...selection.selected] : menuPath ? [menuPath] : [];
  const localTarget = settings.menuPaneTransfers && otherPane?.kind === "local" && menuPaths.length > 0 &&
    menuPaths.every(path => { const entry = entryByPath.get(path); return entry && !entry.isSymlink; }) ? otherPane : undefined;
  const remoteTarget = settings.menuPaneTransfers && otherPane?.kind === "remote" &&
    (otherPane.profileId !== hostId || otherPane.sessionId !== sessionId || otherPane.path !== props.directoryPath) &&
    menuPaths.length > 0 ? otherPane : undefined;
  const download = () => {
    if (!localTarget || !isCurrentPaneDirectory(props.pane, localTarget)) return;
    void copyRemoteFiles(menuPaths, { profileId: hostId, sessionId, path }, localTarget.path, "download");
  };
  const showCreate = (folder: string, kind: "file" | "folder") => createPrompt({
    kind, parentPath: folder, preserveWhitespace: true,
    onCreate: (target, name) => ops.create(target, name, kind === "folder"),
    onCreateAndGo: kind === "folder" ? createFolderAndOpen : undefined,
  });
  const menuEntry = menuPath ? entryByPath.get(menuPath) : undefined;
  const menuItems: ContextMenuItem[] = !menu ? [] : !menuPath ? backgroundMenu : !menuEntry ? [] : [
    ...buildEntryOpenItems({ target: menuEntry, targetCount: menuPaths.length, onOpenEntry: openFile,
      onOpenDir: props.onNavigate, onOpenDirNewTab: props.onOpenTab,
      onOpenGallery: !menuEntry.isSymlink && isPreviewableEntry(menuEntry, settings.galleryAudio) ? props.preview.open : undefined,
      galleryPath: menuEntry.path }),
    ...(menuEntry.isDir && !menuEntry.isSymlink && menuPaths.length === 1 ? [
      { id: "new-folder", label: "New folder", icon: "new-folder" as const, onSelect: () => showCreate(menuEntry.path, "folder") },
      { id: "new-file", label: "New file", icon: "new-file" as const, onSelect: () => showCreate(menuEntry.path, "file") },
    ] : []),
    { id: "copy", icon: "copy", label: "Copy", onSelect: () => copySelection(menuPaths) },
    ...(menuEntry.isDir && !menuEntry.isSymlink && menuPaths.length === 1 ? [{ id: "paste", icon: "paste-into-folder" as const,
      label: "Paste into folder", disabled: !canPaste, onSelect: () => paste(menuEntry.path) }] : []),
    ...(localTarget ? [{ id: "copy-to-pane", icon: "copy" as const, label: "Copy to other pane", tooltip: localTarget.path, onSelect: download }] : []),
    ...(localTarget ? [{ id: "move-to-local-pane", icon: "paste-into-folder" as const, label: "Move to other pane", tooltip: localTarget.path,
      onSelect: () => { if (!isCurrentPaneDirectory(props.pane, localTarget)) return;
        void copyRemoteFiles(menuPaths, { profileId: hostId, sessionId, path }, localTarget.path, "download", true, undefined, entryByPath); } }] : []),
    ...(remoteTarget ? [{ id: "copy-to-remote-pane", icon: "copy" as const, label: "Copy to other pane", tooltip: remoteTarget.path,
      onSelect: () => { if (!isCurrentPaneDirectory(props.pane, remoteTarget)) return;
        void copyRemoteFiles(menuPaths, { profileId: hostId, sessionId, path }, "", "download", false, remoteTarget, entryByPath); } }] : []),
    ...(remoteTarget ? [{ id: "move-to-pane", icon: "paste-into-folder" as const, label: "Move to other pane", tooltip: remoteTarget.path,
      onSelect: () => { if (!isCurrentPaneDirectory(props.pane, remoteTarget)) return;
        if (remoteTarget.profileId === hostId && remoteTarget.sessionId === sessionId) {
          void moveRemoteEntries(entries.filter(entry => menuPaths.includes(entry.path)), hostId, sessionId, props.directoryPath, remoteTarget.path);
        } else {
          void copyRemoteFiles(menuPaths, { profileId: hostId, sessionId, path }, "", "download", true, remoteTarget, entryByPath);
        } } }] : []),
    ...buildEntryRenameItems({ target: menuEntry, hasTargets: true, multiple: menuPaths.length > 1,
      onRenameEntry: () => menuPaths.length === 1 ? ops.startRename(menuEntry) : ops.startBatchRename(entries.filter(entry => menuPaths.includes(entry.path)))}),
    { id: "entry-delete", label: "Delete", icon: "delete", onSelect: () => ops.deleteEntries(menuPaths.flatMap(path => entryByPath.get(path) ? [entryByPath.get(path)!] : [])) },
  ];
  return <div className="remote-entries" ref={container} tabIndex={-1} onKeyDown={onKeyDown}
    onScrollCapture={e => { if ((e.target as Element).matches(".list-body, .thumb-viewport")) props.onScrollTop?.((e.target as HTMLElement).scrollTop); }}>
    <Suspense fallback={null}>{props.viewMode === "list"
      ? <FileList {...common} list={{ sortState: props.sort, onSortChange: props.onSort, categoryTinting: settings.categoryTinting, onVisibleEntries: setVisible,
          nameEllipsis: settings.gridNameEllipsis, hideExtension: settings.gridNameHideExtension }} />
      : <FileGrid {...common} grid={{ pane: props.pane, gridSize: settings.gridSize, gridAutoColumns: settings.gridAutoColumns,
          gridGap: settings.gridGap, gridShowSize: settings.gridShowSize, gridShowExtension: settings.gridShowExtension,
          gridNameEllipsis: settings.gridNameEllipsis, gridNameHideExtension: settings.gridNameHideExtension,
          onGridColumnsChange: n => { columns.current = n; } }}
          thumbs={{ thumbnailsEnabled: false, thumbnails: emptyPreviews, onRequestThumbs: noop,
            onVisibleEntries: setVisible, externalPreview: entry => preview(entry) || undefined,
            thumbnailFit: settings.thumbnailFit, thumbnailAppIcons: settings.thumbnailAppIcons, thumbnailFolders: false, thumbnailVideos: false,
            thumbnailSvgs: false, categoryTinting: settings.categoryTinting }} />}</Suspense>
    <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} scrollContainer={container}
      onClose={() => setMenu(null)} items={menuItems} />
  </div>;
}
