// Small status marker used by indexed-search drive rows.
//
// The visual marker stays separate from the drive list so state-to-icon mapping
// is easy to scan and update when backend states evolve.
import { CheckmarkIcon, ErrorIcon, HourglassIcon, RefreshIcon, WarningIcon } from "@/components/icons";
import { TooltipWrapper } from "../Tooltip";
import { formatIndexedDriveState, isCheckingIndexedDrive } from "@/lib";
import type { IndexedDriveState, IndexedDriveStatus } from "@/types";

type IndicatorState = IndexedDriveState | "checking";

const statusDescriptions: Partial<Record<IndicatorState, string>> = {
  checking: "Verifying the saved index for this drive.",
  ready: "The index tracks NTFS changes across the drive.",
  saved: "Saved results are available. Drive-wide updates depend on the NTFS change journal.",
  queued: "This drive will refresh when a scan slot is available.",
  scanning: "Stratum is scanning this drive in the background.",
  rescanrequired: "This drive needs a fresh index.",
  stale: "The saved index may be out of date.",
  unavailable: "Stratum couldn't access this drive.",
  excluded: "This drive is excluded from indexing in Settings.",
  unsupported: "Indexed search supports fixed NTFS drives.",
  unknown: "The drive's indexing status hasn't been determined.",
  error: "Stratum couldn't finish updating this index.",
};

const renderIndexedDriveStateMarker = (state: IndicatorState) => {
  switch (state) {
    case "ready":
    case "saved":
      return <CheckmarkIcon className="indexed-search-drive-state-icon" />;
    case "queued":
      return <HourglassIcon className="indexed-search-drive-state-icon" />;
    case "scanning":
    case "checking":
      return <RefreshIcon className="indexed-search-drive-state-icon indexed-search-refresh-spinner" />;
    case "stale":
    case "rescanrequired":
    case "unsupported":
    case "unavailable":
    case "unknown":
      return <WarningIcon className="indexed-search-drive-state-icon" />;
    case "error":
      return <ErrorIcon className="indexed-search-drive-state-icon" />;
    default:
      return null;
  }
};

export const IndexedDriveStateBadge = ({ status, checkingIndex }: { status: IndexedDriveStatus; checkingIndex: boolean }) => {
  const state = isCheckingIndexedDrive(status.state, checkingIndex) ? "checking" : status.state;
  const label = state === "checking" ? "Checking index…" : formatIndexedDriveState(state);
  const fallback = statusDescriptions[state];
  const reason = state === "checking" ? null : status.message?.trim().replace(/\s+/g, " ");
  // Keep long filesystem paths and OS diagnostics from filling the tooltip.
  const detail = fallback && (reason || fallback);
  const concise = detail && detail.length > 120 ? detail.slice(0, 119).trimEnd() + "…" : detail;
  const text = concise ? `${label}\n${concise}` : label;
  return (
    <TooltipWrapper text={text}>
      <span
        className="indexed-search-drive-state"
        data-state={state}
      >
        {renderIndexedDriveStateMarker(state)}
        {label}
      </span>
    </TooltipWrapper>
  );
};
