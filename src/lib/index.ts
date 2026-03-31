// Barrel exports for shared helpers and utilities.
export { isEditableElement } from "./dom";
export { getEmptyMessage } from "./emptyMessage";
export { buildEntryItems, isEntryItem } from "./entryItems";
export type { EntryPresence } from "./entryPresence";
export { formatFailures } from "./failures";
export { splitNameExtension, stripNameExtension } from "./fileName";
export { getExtension, getFileKind, isPdfLikeExtension, isSvgLikeExtension } from "./fileKind";
export { initDebug, makeDebug, measure, measureAsync } from "./debug";
export { formatBytes, formatCount, formatDate, formatPercent } from "./format";
export { handleMiddleClick } from "./mouse";
export { getPlatformLabel } from "./platform";
export { buildPreviewUrl } from "./previewUrl";
export { getDropTargetFromPoint, getDropTargetHit } from "./dropTarget";
export type {
  DropTarget,
  DropTargetHit,
  DropTargetSubmenuItem,
  TabDropSubmenuState,
} from "./dropTarget";
export { buildDropCandidate, joinPath, normalizeDropPath, sanitizeDropPath } from "./dropPaths";
export type { DropCandidate } from "./dropPaths";
export {
  buildPathCrumbs,
  getNextTrailPath,
  resolvePathCrumbs,
} from "./pathCrumbs";
export type { PathCrumb, PathCrumbsState } from "./pathCrumbs";
export { activeDrive, getParentPath, getPathName, normalizePath, tabLabel } from "./paths";
export { entryExists, getDriveKey, toMessage } from "./fsUtils";
export { applyHiddenExtension, buildBulkRenamePlan, getRenameInputValue } from "./renamePlan";
export { formatDeleteLabel, getSelectionTargets } from "./selection";
export { DEFAULT_SORT, getDefaultSortDir, nextSortState, sortEntries } from "./sort";
export { createTab, DEFAULT_TAB_STATE } from "./tabs";
export { buildDriveTooltip, buildEntryTooltip } from "./tooltips";
export type { EntryItem } from "./entryItems";
export type { FileKind } from "./fileKind";
