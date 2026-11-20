// Drive list and index status for each mounted volume.
import { PressButton } from "@/components/primitives";
import { formatIndexedDriveSummary } from "@/lib";
import type { IndexedDriveStatus } from "@/types";
import { IndexedDriveStateBadge } from "./IndexedDriveStateBadge";

type IndexedSearchDriveListProps = {
  driveStatuses: IndexedDriveStatus[];
  onSelectDrive: (drivePath: string) => void;
  selectedDrivePath: string | undefined;
  statusLoading: boolean;
};

export const IndexedSearchDriveList = ({
  driveStatuses,
  onSelectDrive,
  selectedDrivePath,
  statusLoading,
}: IndexedSearchDriveListProps) => {
  return (
    <section className="indexed-search-drives" aria-label="Drives">
      <div className="indexed-search-section-head">
        <h3 className="indexed-search-section-title">Drives</h3>
      </div>

      {driveStatuses.length === 0 ? (
        <p className="indexed-search-drive-empty">
          {statusLoading ? "Checking drives…" : "No drive status available."}
        </p>
      ) : (
        <div className="indexed-search-drive-list">
          {driveStatuses.map((status) => (
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
              <IndexedDriveStateBadge status={status} />
            </PressButton>
          ))}
        </div>
      )}
    </section>
  );
};
