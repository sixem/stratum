// Drive list and index status for each mounted volume.
import { useMemo } from "react";
import { PressButton } from "@/components/primitives";
import { formatIndexedDriveSummary } from "@/lib";
import type { IndexedDriveStatus } from "@/types";
import { IndexedDriveStateBadge } from "./IndexedDriveStateBadge";

// Keep supported drives stable as they move between queued, scanning and ready.
const driveOrder = (state: IndexedDriveStatus["state"]) => {
  switch (state) {
    case "excluded": return 1;
    case "unavailable":
    case "unknown": return 2;
    case "unsupported": return 3;
    default: return 0;
  }
};

type IndexedSearchDriveListProps = {
  driveStatuses: IndexedDriveStatus[];
  onSelectDrive: (drivePath: string) => void;
  selectedDrivePath: string | undefined;
  checkingIndex: boolean;
};

export const IndexedSearchDriveList = ({
  driveStatuses,
  onSelectDrive,
  selectedDrivePath,
  checkingIndex,
}: IndexedSearchDriveListProps) => {
  const orderedDrives = useMemo(() => [...driveStatuses].sort((left, right) =>
    driveOrder(left.state) - driveOrder(right.state) || left.drivePath.localeCompare(right.drivePath),
  ), [driveStatuses]);

  return (
    <section className="indexed-search-drives" aria-label="Drives">
      <div className="indexed-search-section-head">
        <h3 className="indexed-search-section-title">Drives</h3>
      </div>

      {driveStatuses.length === 0 ? (
        <p className="indexed-search-drive-empty">
          {checkingIndex ? "Checking drives…" : "No drive status available."}
        </p>
      ) : (
        <div className="indexed-search-drive-list">
          {orderedDrives.map((status) => (
            <PressButton
              key={status.drivePath}
              type="button"
              className="indexed-search-drive"
              aria-pressed={selectedDrivePath === status.drivePath}
              pressOnPointerDown={false}
              onClick={() => onSelectDrive(status.drivePath)}
            >
              <span className="indexed-search-drive-copy">
                <span className="indexed-search-drive-path">{status.drivePath}</span>
                <span className="indexed-search-drive-meta tnum">
                  {formatIndexedDriveSummary(status) ?? status.filesystem ?? "Unknown filesystem"}
                </span>
              </span>
              <IndexedDriveStateBadge status={status} checkingIndex={checkingIndex} />
            </PressButton>
          ))}
        </div>
      )}
    </section>
  );
};
