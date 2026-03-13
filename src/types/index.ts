// Barrel exports for shared type definitions.
export type {
  CopyConflict,
  CopyConflictKind,
  CopyOptions,
  CopyPlan,
  CopyReport,
  DeleteReport,
  DriveInfo,
  RecycleEntry,
  EntryMeta,
  FileEntry,
  FolderThumbSampleBatchOptions,
  FolderThumbSampleBatchResult,
  ListDirOptions,
  ListDirResult,
  ListDirWithParentResult,
  Place,
  RestoreReport,
  RestorePathsReport,
  TrashReport,
  TransferMode,
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
  ThumbnailEvent,
  ThumbnailFormat,
  ThumbnailHit,
  ThumbnailRequest,
  ThumbnailRequestOptions,
} from "./thumbs";
export type { RenameCommitReason, ViewMode } from "./view";
