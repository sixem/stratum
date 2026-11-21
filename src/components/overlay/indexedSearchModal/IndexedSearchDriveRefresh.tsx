// The indexed-search refresh action stays in place while a drive is busy.
import { HourglassIcon, RefreshIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives";
import { isIndexedDriveActiveState } from "@/lib";
import type { IndexedDriveStatus } from "@/types";

type Props = {
  drive: IndexedDriveStatus;
  rebuildingDrivePath: string | null;
  onRebuildDrive: (drivePath: string) => void;
};

export const IndexedSearchDriveRefresh = ({ drive, rebuildingDrivePath, onRebuildDrive }: Props) => {
  if (!drive.indexable) return null;

  const scanning = drive.state === "scanning";
  const pending = rebuildingDrivePath === drive.drivePath;
  const queued = pending || drive.state === "queued";
  const disabled = rebuildingDrivePath != null || isIndexedDriveActiveState(drive.state);

  let detail = drive.message?.trim();
  if (pending) {
    detail = "Queuing a refresh for this drive.";
  } else if (queued) {
    detail ||= "This drive will refresh when a scan slot is available.";
  } else if (scanning) {
    detail ||= "Stratum is refreshing the index in the background.";
  } else if (rebuildingDrivePath != null) {
    detail = "Queuing a refresh for another drive.";
  }

  return (
    <TooltipWrapper text={detail ? `Refresh index\n${detail}` : "Refresh the selected drive’s index"}>
      <PressButton
        type="button"
        className="btn ghost indexed-search-selection-detail-action"
        aria-disabled={disabled || undefined}
        aria-description={detail || undefined}
        pressOnPointerDown={false}
        onClick={() => {
          if (!disabled) onRebuildDrive(drive.drivePath);
        }}
      >
        {queued ? <HourglassIcon /> : <RefreshIcon className={scanning ? "indexed-search-refresh-spinner" : undefined} />}
        Refresh index
      </PressButton>
    </TooltipWrapper>
  );
};
