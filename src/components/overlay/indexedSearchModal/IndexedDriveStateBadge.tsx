// Small status marker used by indexed-search drive rows.
//
// The visual marker stays separate from the drive list so state-to-icon mapping
// is easy to scan and update when backend states evolve.
import loader from "@/assets/icons/loaders/ring.svg";
import { CheckmarkIcon, ErrorIcon, WarningIcon } from "@/components/icons";
import { formatIndexedDriveState } from "@/lib";
import type { IndexedDriveState } from "@/types";

const renderIndexedDriveStateMarker = (state: IndexedDriveState) => {
  switch (state) {
    case "ready":
      return <CheckmarkIcon className="indexed-search-drive-state-icon" />;
    case "queued":
    case "scanning":
      return (
        <img
          src={loader}
          alt=""
          aria-hidden="true"
          className="indexed-search-drive-state-icon indexed-search-drive-state-loader"
        />
      );
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

export const IndexedDriveStateBadge = ({ state }: { state: IndexedDriveState }) => {
  return (
    <span
      className="indexed-search-drive-state"
      data-state={state}
      role="img"
      aria-label={formatIndexedDriveState(state)}
    >
      {renderIndexedDriveStateMarker(state)}
    </span>
  );
};
