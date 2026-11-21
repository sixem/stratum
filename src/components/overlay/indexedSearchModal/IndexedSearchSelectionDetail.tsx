// Selection detail panel for indexed-search result and drive rows.
//
// The panel receives already-selected domain objects and renders their details;
// actions are passed in so opening files and rebuilding drives stay testable in
// the modal hooks.
import { OpenExternalIcon } from "@/components/icons";
import { ContextOpenIcon } from "@/components/icons/contextMenuIcons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives";
import {
  formatBytes,
  formatDate,
  formatIndexedDriveSummary,
  formatPercent,
  isIndexedDriveAttentionState,
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
  onOpenResult: (result: IndexedPathMatch) => void;
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
  const selectedDriveWarning = selectedDrive && isIndexedDriveAttentionState(selectedDrive.state)
    ? selectedDrive.message?.trim()
    : null;

  return (
    <section className="indexed-search-selection-detail" aria-label="Selection details">
      <h3 className="indexed-search-section-title">Details</h3>
      {selectedResult ? (
        <>
          <div className="indexed-search-selection-detail-head">
            <div className="indexed-search-selection-detail-copy">
              <TooltipWrapper text={selectedResult.name}>
                <div className="indexed-search-selection-detail-title">{selectedResult.name}</div>
              </TooltipWrapper>
              <TooltipWrapper text={selectedResult.path}>
                <div className="indexed-search-selection-detail-meta">
                  {selectedResult.parentPath || selectedResult.path}
                </div>
              </TooltipWrapper>
            </div>
            <PressButton
              type="button"
              className="btn indexed-search-selection-detail-action"
              onClick={() => onOpenResult(selectedResult)}
            >
              {selectedResult.kind === "file" ? <OpenExternalIcon /> : <ContextOpenIcon />}
              Open
            </PressButton>
          </div>

          <div className="indexed-search-selection-stats">
            <div className="indexed-search-selection-stat">
              <span className="indexed-search-selection-stat-label">Size</span>
              <span className="indexed-search-selection-stat-value tnum">
                {selectedResult.kind === "directory"
                  ? "—"
                  : formatBytes(selectedResultMeta?.size ?? null)}
              </span>
            </div>
            <div className="indexed-search-selection-stat">
              <span className="indexed-search-selection-stat-label">Modified</span>
              <span className="indexed-search-selection-stat-value tnum">
                {formatDate(selectedResultMeta?.modified ?? null)}
              </span>
            </div>
          </div>

          {selectionError ? (
            <div className="indexed-search-section-note" role="status">{selectionError}</div>
          ) : null}
        </>
      ) : selectedDrive ? (
        <>
          <div className="indexed-search-selection-detail-head">
            <div className="indexed-search-selection-detail-copy">
              <div className="indexed-search-selection-detail-title">
                {selectedDriveInfo?.label || selectedDrive.drivePath}
              </div>
              {selectedDriveInfo?.label ? (
                <div className="indexed-search-selection-detail-meta">{selectedDrive.drivePath}</div>
              ) : null}
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
                {rebuildingDrivePath === selectedDrive.drivePath ? "Queuing…" : "Refresh index"}
              </PressButton>
            ) : null}
          </div>

          {selectedDriveSummary ? (
            <div className="indexed-search-selection-detail-meta tnum">
              {selectedDriveSummary}
            </div>
          ) : null}

          {selectedDriveWarning ? (
            <div className="indexed-search-section-note">
              {selectedDriveWarning}
            </div>
          ) : null}

          {selectedDriveUsageLabel ? (
            <div className="indexed-search-selection-detail-meta tnum">
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
        <p className="indexed-search-selection-detail-empty">Select a result or drive to see details.</p>
      )}
    </section>
  );
};
