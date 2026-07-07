// Selection detail panel for indexed-search result and drive rows.
//
// The panel receives already-selected domain objects and renders their details;
// actions are passed in so opening files and rebuilding drives stay testable in
// the modal hooks.
import { PressButton } from "@/components/primitives";
import {
  formatBytes,
  formatDate,
  formatIndexedDriveSummary,
  formatPercent,
} from "@/lib";
import type {
  DriveInfo,
  EntryMeta,
  IndexedDriveStatus,
  IndexedPathMatch,
} from "@/types";
import { normalizeDrivePathKey } from "./indexedSearchModalTypes";

type IndexedSearchSelectionDetailProps = {
  rebuildingDrivePath: string | null;
  selectedDrive: IndexedDriveStatus | null;
  selectedResult: IndexedPathMatch | null;
  selectedResultMeta: EntryMeta | null;
  selectionError: string | null;
  visibleDriveInfo: DriveInfo[] | null;
  onOpenResult: (path: string) => void;
  onRebuildDrive: (drivePath: string) => void;
};

export const IndexedSearchSelectionDetail = ({
  rebuildingDrivePath,
  selectedDrive,
  selectedResult,
  selectedResultMeta,
  selectionError,
  visibleDriveInfo,
  onOpenResult,
  onRebuildDrive,
}: IndexedSearchSelectionDetailProps) => {
  const selectedDriveInfo = selectedDrive
    ? visibleDriveInfo?.find(
        (info) =>
          normalizeDrivePathKey(info.path) === normalizeDrivePathKey(selectedDrive.drivePath),
      ) ?? null
    : null;
  const selectedDriveUsed =
    selectedDriveInfo?.total != null && selectedDriveInfo.free != null
      ? Math.max(0, selectedDriveInfo.total - selectedDriveInfo.free)
      : null;
  const selectedDriveUsageLabel =
    selectedDriveInfo?.total != null && selectedDriveUsed != null
      ? `${formatBytes(selectedDriveUsed)} used / ${formatBytes(selectedDriveInfo.total)} total`
      : null;
  const selectedDriveUsagePercentLabel =
    selectedDriveInfo?.total != null &&
    selectedDriveInfo.total > 0 &&
    selectedDriveUsed != null
      ? formatPercent(selectedDriveUsed, selectedDriveInfo.total)
      : null;
  const selectedDriveSummary = selectedDrive
    ? formatIndexedDriveSummary(selectedDrive)
    : null;

  return (
    <div className="indexed-search-selection-detail">
      {selectedResult ? (
        <>
          <div className="indexed-search-selection-detail-head">
            <div className="indexed-search-selection-detail-copy">
              <button
                type="button"
                className="indexed-search-selection-detail-title-action"
                onDoubleClick={() => {
                  onOpenResult(selectedResult.path);
                }}
              >
                <span className="indexed-search-selection-detail-title">
                  {selectedResult.name}
                </span>
              </button>
            </div>
          </div>

          <div className="indexed-search-selection-detail-meta">
            {selectedResult.parentPath ?? selectedResult.drivePath ?? "No parent directory"}
          </div>

          <div className="indexed-search-selection-stats">
            <div className="indexed-search-selection-stat">
              <span className="indexed-search-selection-stat-label">Size</span>
              <span className="indexed-search-selection-stat-value">
                {selectedResult.kind === "directory"
                  ? "Directory"
                  : formatBytes(selectedResultMeta?.size ?? null)}
              </span>
            </div>
            <div className="indexed-search-selection-stat">
              <span className="indexed-search-selection-stat-label">Modified</span>
              <span className="indexed-search-selection-stat-value">
                {formatDate(selectedResultMeta?.modified ?? null)}
              </span>
            </div>
          </div>

          {selectionError ? (
            <div className="indexed-search-selection-detail-note">{selectionError}</div>
          ) : null}
        </>
      ) : selectedDrive ? (
        <>
          <div className="indexed-search-selection-detail-head">
            <div className="indexed-search-selection-detail-copy">
              <div className="indexed-search-selection-detail-title">
                {selectedDrive.drivePath}
              </div>
            </div>
            {selectedDrive.indexable ? (
              <PressButton
                type="button"
                className="btn ghost indexed-search-selection-detail-action"
                disabled={
                  rebuildingDrivePath != null ||
                  selectedDrive.state === "queued" ||
                  selectedDrive.state === "scanning"
                }
                onClick={() => {
                  onRebuildDrive(selectedDrive.drivePath);
                }}
              >
                {rebuildingDrivePath === selectedDrive.drivePath ? "Rebuilding..." : "Rebuild"}
              </PressButton>
            ) : null}
          </div>

          {selectedDriveSummary ? (
            <div className="indexed-search-selection-detail-meta">
              {selectedDriveSummary}
            </div>
          ) : null}

          {selectedDriveUsageLabel ? (
            <div className="indexed-search-selection-detail-meta">
              {selectedDriveUsageLabel}
            </div>
          ) : null}

          {selectedDriveUsagePercentLabel ? (
            <div
              className="indexed-search-selection-progress"
              aria-label={`${selectedDriveUsagePercentLabel} used`}
            >
              <span
                className="indexed-search-selection-progress-fill"
                style={{ width: selectedDriveUsagePercentLabel }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="indexed-search-selection-detail-empty">Nothing selected yet.</div>
      )}
    </div>
  );
};
