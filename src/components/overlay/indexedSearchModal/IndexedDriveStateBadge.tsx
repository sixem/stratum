// Small status marker used by indexed-search drive rows.
//
// The visual marker stays separate from the drive list so state-to-icon mapping
// is easy to scan and update when backend states evolve.
import { CheckmarkIcon, ErrorIcon, HourglassIcon, RefreshIcon, WarningIcon } from "@/components/icons";
import { TooltipWrapper } from "../Tooltip";
import { formatIndexedDriveState } from "@/lib";
import type { IndexedDriveState, IndexedDriveStatus } from "@/types";

const statusDescriptions: Partial<Record<IndexedDriveState, string>> = {
  saved: "A complete saved index is available. Open folders and Stratum file operations keep affected paths up to date.",
  rescanrequired: "This drive needs a fresh index.",
  stale: "The saved index may be out of date.",
  unavailable: "Stratum couldn't access this drive.",
  unsupported: "Indexed search supports fixed NTFS drives.",
  unknown: "The drive's indexing status hasn't been determined.",
  error: "Stratum couldn't finish updating this index.",
};

const renderIndexedDriveStateMarker = (state: IndexedDriveState) => {
  switch (state) {
    case "ready":
    case "saved":
      return <CheckmarkIcon className="indexed-search-drive-state-icon" />;
    case "queued":
      return <HourglassIcon className="indexed-search-drive-state-icon" />;
    case "scanning":
      return <RefreshIcon className="indexed-search-drive-state-icon" />;
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

export const IndexedDriveStateBadge = ({ status }: { status: IndexedDriveStatus }) => {
  const { state } = status;
  const label = formatIndexedDriveState(state);
  const fallback = statusDescriptions[state];
  const reason = status.message?.trim().replace(/\s+/g, " ");
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
