// Barrel exports for shared app hooks.
// Domain hooks: data access, tab state, and OS-facing workflows.
export { useClipboardSync } from "./domain/useClipboardSync";
export { useDirWatch } from "./domain/useDirWatch";
export { useDriveInfo } from "./domain/useDriveInfo";
export { useEntryMetaRequest } from "./domain/useEntryMetaRequest";
export { useEntryPresence } from "./domain/useEntryPresence";
export { useFileIcons } from "./domain/useFileIcons";
export { useFileDrop } from "./domain/useFileDrop";
export { useFileManager } from "./domain/useFileManager";
export { useFileViewModel } from "./ui/useFileViewModel";
export { useFilteredEntries } from "./domain/useFilteredEntries";
export { useMetaPrefetch } from "./domain/useMetaPrefetch";
export { useSettings } from "./domain/useSettings";
export { useShellAvailability } from "./domain/useShellAvailability";
export { useStatusLabels } from "./domain/useStatusLabels";
export { useTabSession } from "./domain/useTabSession";
export { useThumbnails } from "./domain/useThumbnails";
export { useTransferProgress } from "./domain/useTransferProgress";

// UI hooks: presentation orchestration, menus, and interaction state.
export { useAppAppearance } from "./ui/useAppAppearance";
export { useAppMenuState } from "./ui/useAppMenuState";
export { useAppViewState } from "./ui/useAppViewState";
export { useCloseConfirm } from "./ui/useCloseConfirm";
export { useCreateEntryPrompt } from "./ui/useCreateEntryPrompt";
export { useCssVarHeight } from "./ui/useCssVarHeight";
export { useDragOutHandler } from "./ui/useDragOutHandler";
export { useEntryDragOut } from "./ui/useEntryDragOut";
export { useEntryMenuItems } from "./ui/useEntryMenuItems";
export { useFileViewInteractions } from "./ui/useFileViewInteractions";
export { useFileViewSelection } from "./ui/useFileViewSelection";
export { useKeybinds } from "./ui/useKeybinds";
export { useLayoutMenuItems } from "./ui/useLayoutMenuItems";
export { useSearchHotkey } from "./ui/useSearchHotkey";
export { useSelection } from "./ui/useSelection";
export { useSelectionDrag } from "./ui/useSelectionDrag";
export { useSelectionShortcuts } from "./ui/useSelectionShortcuts";
export { useSortMenuItems } from "./ui/useSortMenuItems";
export { useTabDragDrop } from "./ui/useTabDragDrop";
export { useTypeaheadSelection } from "./ui/useTypeaheadSelection";

// Perf hooks: scrolling, sizing, and throttled view work.
export { useDynamicOverscan } from "./perf/useDynamicOverscan";
export { useElementSize } from "./perf/useElementSize";
export { useLayoutBusy } from "./perf/useLayoutBusy";
export { useNowTick } from "./perf/useNowTick";
export { useScrollRequest } from "./perf/useScrollRequest";
export { useScrollReset } from "./perf/useScrollReset";
export { useScrollRestore } from "./perf/useScrollRestore";
export { useScrollSettled } from "./perf/useScrollSettled";
export { useScrollToIndex } from "./perf/useScrollToIndex";
export { useThumbnailPause } from "./perf/useThumbnailPause";
export { useThumbnailRequest } from "./perf/useThumbnailRequest";
export { useTypingActivity } from "./perf/useTypingActivity";
export { useViewReady } from "./perf/useViewReady";
export { useVirtualRange } from "./perf/useVirtualRange";
export { useWheelSnap } from "./perf/useWheelSnap";
export { useWindowSize } from "./perf/useWindowSize";

export type { SelectionBox } from "./ui/useSelectionDrag";
export type { TypeaheadItem } from "./ui/useTypeaheadSelection";
