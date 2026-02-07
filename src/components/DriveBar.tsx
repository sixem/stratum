// Deprecated drive bar; not wired in App. Remove when safe.
import type { MouseEvent as ReactMouseEvent } from "react";
import { activeDrive, buildDriveTooltip, handleMiddleClick, normalizePath } from "@/lib";
import { PressButton } from "./PressButton";
import { TooltipWrapper } from "./Tooltip";
import type { DriveInfo } from "@/types";

type DriveBarProps = {
  drives: string[];
  driveInfo: Map<string, DriveInfo>;
  activePath: string;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

type DriveListProps = {
  drives: string[];
  driveInfo: Map<string, DriveInfo>;
  currentDrive: string | null;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

const DriveList = ({
  drives,
  driveInfo,
  currentDrive,
  onSelect,
  onSelectNewTab,
}: DriveListProps) => {
  if (drives.length === 0) {
    return <div className="drive is-empty">No drives</div>;
  }

  const handleOpenNewTab = (event: ReactMouseEvent, path: string) => {
    if (!onSelectNewTab) return;
    handleMiddleClick(event, () => onSelectNewTab(path));
  };

  return drives.map((drive) => {
    const label = drive.replace(/\\+/g, "").toUpperCase();
    const isActive = currentDrive?.toLowerCase() === drive.toLowerCase();
    const info = driveInfo.get(normalizePath(drive));
    const tooltipText = buildDriveTooltip(label, info);
    return (
      <TooltipWrapper key={drive} text={tooltipText}>
        <PressButton
          type="button"
          className={`drive${isActive ? " is-active" : ""}`}
          onClick={() => onSelect(drive)}
          onMouseDown={(event) => handleOpenNewTab(event, drive)}
        >
          {label}
        </PressButton>
      </TooltipWrapper>
    );
  });
};

export const DriveBar = ({
  drives,
  driveInfo,
  activePath,
  onSelect,
  onSelectNewTab,
}: DriveBarProps) => {
  const currentDrive = activeDrive(activePath, drives);

  return (
    <header className="drivebar">
      <div className="brand">
        <div className="brand-title">Drives:</div>
      </div>
      <div className="drive-list">
        <DriveList
          drives={drives}
          driveInfo={driveInfo}
          currentDrive={currentDrive}
          onSelect={onSelect}
          onSelectNewTab={onSelectNewTab}
        />
      </div>
    </header>
  );
};
