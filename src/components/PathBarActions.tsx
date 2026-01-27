// Action cluster aligned to the right side of the path bar.
import { TransferStatusButton } from "./TransferStatusButton";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { GridIcon, ListIcon, SettingsIcon } from "./Icons";
import type { ViewMode } from "@/types";

type PathBarActionsProps = {
  viewMode: ViewMode;
  settingsOpen: boolean;
  onViewChange: (mode: ViewMode) => void;
  onToggleSettings: () => void;
};

export const PathBarActions = ({
  viewMode,
  settingsOpen,
  onViewChange,
  onToggleSettings,
}: PathBarActionsProps) => {
  return (
    <div className="pathbar-actions">
      <TransferStatusButton />
      <div className="view-switch">
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
    </div>
  );
};
