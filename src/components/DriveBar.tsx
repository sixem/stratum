// Drive picker and view toggles for the top bar.
import type { MouseEvent as ReactMouseEvent } from "react";
import { activeDrive, buildDriveTooltip, handleMiddleClick, normalizePath } from "@/lib";
import { TooltipWrapper } from "./Tooltip";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { GridIcon, ListIcon, SettingsIcon, SidebarIcon } from "./Icons";
import type { DriveInfo, ViewMode } from "@/types";

type DriveBarProps = {
  drives: string[];
  driveInfo: Map<string, DriveInfo>;
  activePath: string;
  viewMode: ViewMode;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
  onViewChange: (mode: ViewMode) => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
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
        <button
          type="button"
          className={`drive${isActive ? " is-active" : ""}`}
          onClick={() => onSelect(drive)}
          onMouseDown={(event) => handleOpenNewTab(event, drive)}
        >
          {label}
        </button>
      </TooltipWrapper>
    );
  });
};

export function DriveBar({
  drives,
  driveInfo,
  activePath,
  viewMode,
  sidebarOpen,
  settingsOpen,
  onSelect,
  onSelectNewTab,
  onViewChange,
  onToggleSidebar,
  onToggleSettings,
}: DriveBarProps) {
  const currentDrive = activeDrive(activePath, drives);

  return (
    <header className="drivebar">
      <div className="brand">
        <div className="brand-mark">ST</div>
        <div className="brand-title">Stratum</div>
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
      <div className="view-switch">
        <ToolbarIconButton
          label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          active={sidebarOpen}
          pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <SidebarIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="List view"
          active={viewMode === "list"}
          pressed={viewMode === "list"}
          onClick={() => onViewChange("list")}
        >
          <ListIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="Thumbnails view"
          active={viewMode === "thumbs"}
          pressed={viewMode === "thumbs"}
          onClick={() => onViewChange("thumbs")}
        >
          <GridIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="Settings"
          active={settingsOpen}
          pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          <SettingsIcon />
        </ToolbarIconButton>
      </div>
    </header>
  );
}
