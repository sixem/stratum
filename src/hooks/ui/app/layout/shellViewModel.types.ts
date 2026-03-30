// Shared model types for the shell-view composition hooks.
// Keeping these aliases in one place helps the smaller hooks describe their
// contracts without repeating the same ReturnType boilerplate everywhere.
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Place } from "@/types";
import type {
  useClipboardSync,
  useDriveInfo,
  useFileDrop,
  useFileManager,
  useShellAvailability,
} from "@/hooks/domain/filesystem";
import type {
  useFilteredEntries,
  useStatusLabels,
  useThumbnails,
} from "@/hooks/domain/metadata";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
import type { useScrollRequest } from "@/hooks/perf/scroll";
import type { useFileViewInteractions, useFileViewModel } from "@/hooks/ui/view";
import type { useAppCommands } from "../useAppCommands";
import type { useAppContextMenuSection } from "../useAppContextMenuSection";
import type { useAppFileViewController } from "../useAppFileViewController";
import type { useAppMenuState } from "../useAppMenuState";
import type { useAppNavigationController } from "../useAppNavigationController";
import type { useAppPreviewSection } from "../useAppPreviewSection";
import type { useAppRenameFlow } from "../useAppRenameFlow";
import type { useAppSelectionHandlers } from "../useAppSelectionHandlers";
import type { useAppViewState } from "../useAppViewState";
import type { useConversionController } from "../useConversionController";
import { resolveShellViewState } from "./resolveShellViewState";

export type FileManagerModel = ReturnType<typeof useFileManager>;
export type SettingsModel = ReturnType<typeof useSettings>;
export type TabSessionModel = ReturnType<typeof useTabSession>;
export type FileDropModel = ReturnType<typeof useFileDrop>;
export type ScrollStateModel = ReturnType<typeof useScrollRequest>;
export type MenuStateModel = ReturnType<typeof useAppMenuState>;
export type NavigationControllerModel = ReturnType<typeof useAppNavigationController>;
export type ViewStateModel = ReturnType<typeof useAppViewState>;
export type ResolvedViewState = ReturnType<typeof resolveShellViewState>;
export type ViewModel = ReturnType<typeof useFileViewModel>;
export type FileViewInteractionsModel = ReturnType<typeof useFileViewInteractions>;
export type PreviewSectionModel = ReturnType<typeof useAppPreviewSection>;
export type RenameFlowModel = ReturnType<typeof useAppRenameFlow>;
export type SelectionHandlersModel = ReturnType<typeof useAppSelectionHandlers>;
export type AppCommandsModel = ReturnType<typeof useAppCommands>;
export type AppContextMenuModel = ReturnType<typeof useAppContextMenuSection>;
export type AppFileViewControllerModel = ReturnType<typeof useAppFileViewController>;
export type FilteredEntriesModel = ReturnType<typeof useFilteredEntries>;
export type ThumbnailsModel = ReturnType<typeof useThumbnails>;
export type ConversionControllerModel = ReturnType<typeof useConversionController>;
export type DriveInfoModel = ReturnType<typeof useDriveInfo>;
export type ClipboardSyncModel = ReturnType<typeof useClipboardSync>;
export type ShellAvailabilityModel = ReturnType<typeof useShellAvailability>;
export type StatusLabelsModel = ReturnType<typeof useStatusLabels>;

export type UseShellViewModelOptions = {
  tauriEnv: boolean;
  promptOpen: boolean;
  aboutOpen: boolean;
  menuState: MenuStateModel;
  fileManager: FileManagerModel;
  settings: SettingsModel;
  tabSession: TabSessionModel;
  fileDrop: FileDropModel;
  scrollState: ScrollStateModel;
  flushWindowSize: () => void;
  lastViewRef: MutableRefObject<{ tabId: string | null; pathKey: string } | null>;
  setSuppressExternalPresence: Dispatch<SetStateAction<boolean>>;
  thumbResetNonce: number;
  setThumbResetNonce: Dispatch<SetStateAction<number>>;
  resolvedView: ResolvedViewState;
  viewState: ViewStateModel;
  navigationController: NavigationControllerModel;
  places: Place[];
  addPlace: (path: string) => void;
  pinPlace: (path: string) => void;
  unpinPlace: (path: string) => void;
  removePlace: (path: string) => void;
  viewLog: (...args: unknown[]) => void;
};
