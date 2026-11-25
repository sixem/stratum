// Barrel exports for shared type definitions.
export type {
  IndexedDriveState,
  IndexedDriveStatus,
  IndexedEntryKind,
  IndexedPathMatch,
  IndexedPathPage,
  IndexedPathPageQuery,
  IndexedPathQuery,
  IndexedSearchServiceState,
  IndexedSearchServiceStatus,
} from "./indexedSearch";
export type {
  CopyConflict,
  CopyConflictKind,
  CopyOptions,
  CopyPlan,
  CopyReport,
  DeleteReport,
  MovedTransferEntry,
  DriveInfo,
  EntryMeta,
  EntryMetaLookup,
  FileEntry,
  FolderThumbSampleBatchOptions,
  FolderThumbSampleBatchResult,
  ListDirOptions,
  ListDirResult,
  ListDirWithParentResult,
  Place,
  RestoreRecycleReport,
  TrashReport,
  TransferMode,
  TransferDestination,
  TransferJobPhase,
  TransferJobKind,
  TransferJobCapabilities,
  TransferJobSnapshot,
  TransferJobStatus,
  TransferReport,
  TransferJobsSnapshotEvent,
  TransferQueueSnapshot,
  TransferProgressEvent,
  TransferWorkEstimate,
  DirChangedEvent,
  DirRenameEvent,
} from "./fs";
export type {
  ContextMenuItem,
  ContextMenuIcon,
  EntryContextTarget,
  PlaceContextSource,
  PlaceContextTarget,
} from "./contextMenu";
export type { FileIconHit } from "./fileIcons";
export type { OpenWithHandler } from "./opener";
export type {
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionOutputMode,
  ConversionVideoEncoder,
  ConversionVideoFormat,
  ConversionVideoPresetId,
  ConversionVideoSpeed,
  ConversionRunPhase,
  ConversionRunState,
  ConversionRuleDraft,
  ConversionRuleOverrideDraft,
  ConversionItemRunStatus,
} from "./conversion";
export type {
  ConversionJobItem,
  ConversionReport,
  ImageConversionJobItem,
  VideoConversionJobItem,
} from "./conversionJobs";
export type { ImageConvertOptions, ImageInfo, ImageTargetFormat } from "./images";
export type { VideoConvertOptions } from "./videos";
export type { ShellAvailability, ShellKind } from "./shells";
export type { SortDir, SortKey, SortState } from "./sort";
export type { Tab } from "./tabs";
export type {
  RequestScopedThumbnails,
  ThumbnailEvent,
  ThumbnailFormat,
  ThumbnailHit,
  ThumbnailLookup,
  ThumbnailRequest,
  ThumbnailRequestOptions,
  ThumbnailScope,
  ThumbnailView,
} from "./thumbs";
export type { RenameCommitReason, ViewMode } from "./view";
