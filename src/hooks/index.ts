// Barrel exports for shared app hooks.
// Domain hooks: filesystem workflows.
export { useClipboardSync } from "./domain/filesystem/useClipboardSync";
export { useDirWatch } from "./domain/filesystem/useDirWatch";
export { useDriveInfo } from "./domain/filesystem/useDriveInfo";
export { useFileDrop } from "./domain/filesystem/useFileDrop";
export { useFileManager } from "./domain/filesystem/useFileManager";
export { useShellAvailability } from "./domain/filesystem/useShellAvailability";
export { useTransferProgress } from "./domain/filesystem/useTransferProgress";

// Domain hooks: entry metadata and derived labels.
export { useEntryMetaRequest } from "./domain/metadata/useEntryMetaRequest";
export { useEntryPresence } from "./domain/metadata/useEntryPresence";
export { useFileIcons } from "./domain/metadata/useFileIcons";
export { useFilteredEntries } from "./domain/metadata/useFilteredEntries";
export { useMetaPrefetch } from "./domain/metadata/useMetaPrefetch";
export { useStatusLabels } from "./domain/metadata/useStatusLabels";
export { useThumbnails } from "./domain/metadata/useThumbnails";

// Domain hooks: session and settings state.
export { useSettings } from "./domain/session/useSettings";
export { useTabSession } from "./domain/session/useTabSession";

// UI hooks: global app state and overlays.
export { useAppAppearance } from "./ui/app/useAppAppearance";
export { useAppMenuState } from "./ui/app/useAppMenuState";
export { useAppViewState } from "./ui/app/useAppViewState";
export { useCloseConfirm } from "./ui/app/useCloseConfirm";
export { useCreateEntryPrompt } from "./ui/app/useCreateEntryPrompt";
export { useModalFocusTrap } from "./ui/app/useModalFocusTrap";

// UI hooks: view composition.
export { useCssVarHeight } from "./ui/view/useCssVarHeight";
export { useFileViewInteractions } from "./ui/view/useFileViewInteractions";
export { useFileViewModel } from "./ui/view/useFileViewModel";

// UI hooks: selection and typeahead.
export { useEntryDragOut } from "./ui/selection/useEntryDragOut";
export { useFileViewSelection } from "./ui/selection/useFileViewSelection";
export { useSelection } from "./ui/selection/useSelection";
export { useSelectionDrag } from "./ui/selection/useSelectionDrag";
export { useSelectionShortcuts } from "./ui/selection/useSelectionShortcuts";
export { useTypeaheadSelection } from "./ui/selection/useTypeaheadSelection";

// UI hooks: menus.
export { useEntryMenuItems } from "./ui/menus/useEntryMenuItems";
export { useLayoutMenuItems } from "./ui/menus/useLayoutMenuItems";
export { useSortMenuItems } from "./ui/menus/useSortMenuItems";

// UI hooks: input bindings.
export { useDragOutHandler } from "./ui/inputs/useDragOutHandler";
export { useKeybinds } from "./ui/inputs/useKeybinds";
export { useSearchHotkey } from "./ui/inputs/useSearchHotkey";
export { useTabDragDrop } from "./ui/inputs/useTabDragDrop";

// Perf hooks: scroll + virtualization.
export { useDynamicOverscan } from "./perf/scroll/useDynamicOverscan";
export { useScrollRequest } from "./perf/scroll/useScrollRequest";
export { useScrollReset } from "./perf/scroll/useScrollReset";
export { useScrollRestore } from "./perf/scroll/useScrollRestore";
export { useScrollSettled } from "./perf/scroll/useScrollSettled";
export { useScrollToIndex } from "./perf/scroll/useScrollToIndex";
export { useVirtualRange } from "./perf/scroll/useVirtualRange";
export { useWheelSnap } from "./perf/scroll/useWheelSnap";

// Perf hooks: resize + measurement.
export { useElementSize } from "./perf/resize/useElementSize";
export { useLayoutBusy } from "./perf/resize/useLayoutBusy";
export { useWindowSize } from "./perf/resize/useWindowSize";

// Perf hooks: timing + throttling.
export { useNowTick } from "./perf/timing/useNowTick";
export { useThumbnailPause } from "./perf/timing/useThumbnailPause";
export { useThumbnailRequest } from "./perf/timing/useThumbnailRequest";
export { useTypingActivity } from "./perf/timing/useTypingActivity";
export { useViewReady } from "./perf/timing/useViewReady";

export type { SelectionBox } from "./ui/selection/useSelectionDrag";
export type { TypeaheadItem } from "./ui/selection/useTypeaheadSelection";
