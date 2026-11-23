// Adapt a single search result to the shared file/folder menu.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BeginFileActivity } from "@/hooks/domain/filesystem/useFileActivity";
import { appendWindowsMenuItem } from "@/hooks/ui/menus/appendWindowsMenuItem";
import { showEntryRenamePrompt } from "@/hooks/ui/menus/showEntryRenamePrompt";
import { useEntryMenuItems } from "@/hooks/ui/menus/useEntryMenuItems";
import { useWindowsContextMenu } from "@/hooks/ui/menus/useWindowsContextMenu";
import { getParentPath, isPreviewableEntry } from "@/lib";
import { showBottomPane } from "@/modules/bottomPaneStore";
import type { ContextMenuItem, EntryContextTarget, IndexedPathMatch } from "@/types";

export type IndexedSearchMenuActions = Pick<Parameters<typeof useEntryMenuItems>[0],
  "confirmDelete" | "menuShowConvert" | "onDeleteEntries" | "onPasteEntries" |
  "onMoveEntries" | "onOpenConvertModal" | "onQuickConvertImages"
> & {
  windowsMenuEnabled: boolean;
  beginFileActivity: BeginFileActivity;
  onShellCommand: () => void;
  onOpenFolder: (path: string) => void;
  onOpenFolderNewTab: (path: string) => void;
  onRename: (path: string, name: string) => Promise<unknown>;
};

type MenuPoint = { x: number; y: number };
type MenuRequest = MenuPoint & { path: string };

type Options = {
  visible: boolean;
  results: IndexedPathMatch[];
  actions: IndexedSearchMenuActions;
  closeSearch: () => void;
  openResult: (result: IndexedPathMatch) => void;
  openGallery: (path: string) => void;
  selectResult: (result: IndexedPathMatch) => void;
  selectResultForCopy: (result: IndexedPathMatch) => void;
  copyPaths: ReadonlySet<string> | null;
};

const toTarget = (result: IndexedPathMatch): EntryContextTarget => ({
  path: result.path,
  name: result.name,
  isDir: result.kind === "directory",
});

export const useIndexedSearchResultMenu = ({
  visible, results, actions, closeSearch, openResult, openGallery, selectResult, selectResultForCopy, copyPaths,
}: Options) => {
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const result = visible && request ? results.find(({ path }) => path === request.path) : undefined;
  const target = useMemo(() => result ? toTarget(result) : null, [result]);
  const textCopyTargets = useMemo(
    () => result && copyPaths?.has(result.path) ? results.filter(({ path }) => copyPaths.has(path)) : undefined,
    [copyPaths, result, results],
  );
  const close = useCallback(() => setRequest(null), []);
  const openWindowsMenu = useWindowsContextMenu({
    enabled: actions.windowsMenuEnabled,
    beginFileActivity: actions.beginFileActivity,
    closeContextMenu: close,
    onCommand: actions.onShellCommand,
  });

  useEffect(() => {
    if (request && !result) close();
  }, [close, request, result]);

  const openNativeMenu = (entry: EntryContextTarget, point: MenuPoint, extended: boolean) =>
    openWindowsMenu({ paths: [entry.path] }, point, extended,
      isPreviewableEntry(entry) ? () => openGallery(entry.path) : undefined);

  const openAt = (match: IndexedPathMatch, point: MenuPoint, native: boolean) => {
    if (copyPaths?.has(match.path)) selectResult(match);
    else selectResultForCopy(match);
    if (native && openNativeMenu(toTarget(match), point, true)) return;
    setRequest({ path: match.path, ...point });
  };

  const extraOpenItems = useMemo<ContextMenuItem[]>(() => {
    if (!result) return [];
    if (result.kind === "directory") {
      return [{
        id: "indexed-open-current-tab",
        label: "Open in current tab",
        icon: "open-folder",
        onSelect: () => { closeSearch(); actions.onOpenFolder(result.path); },
      }];
    }
    const parent = result.parentPath || getParentPath(result.path);
    return parent ? [{
      id: "indexed-open-containing-folder",
      label: "Open containing folder",
      icon: "open-folder",
      onSelect: () => { closeSearch(); actions.onOpenFolderNewTab(parent); },
    }] : [];
  }, [actions.onOpenFolder, actions.onOpenFolderNewTab, closeSearch, result]);

  const openTarget = () => { if (result) openResult(result); };
  const items = useEntryMenuItems({
    ...actions,
    target,
    extraOpenItems,
    onOpenEntry: openTarget,
    onOpenDir: openTarget,
    onOpenGallery: openGallery,
    onRenameEntry: (entry) => showEntryRenamePrompt(entry, actions.onRename),
    otherPane: { label: "Open in bottom pane", open: (path) => { closeSearch(); showBottomPane(path); } },
    showClipboardShortcuts: false,
    textCopyTargets,
  });

  const onOpenNative = () => Boolean(target && request && openNativeMenu(target, request, false));
  const menuItems = target && actions.windowsMenuEnabled
    ? appendWindowsMenuItem(items, onOpenNative)
    : items;

  return {
    openAt,
    props: {
      open: Boolean(target && menuItems.length),
      items: menuItems,
      x: request?.x ?? 0,
      y: request?.y ?? 0,
      onClose: close,
      onOpenNative,
    },
  };
};
