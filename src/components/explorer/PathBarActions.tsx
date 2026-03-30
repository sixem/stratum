// Action cluster aligned to the right side of the path bar.
import { PATHBAR_TOOLTIP_DELAY_MS } from "@/constants";
import { TransferStatusButton } from "@/components/transfer/TransferStatusButton";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { GridIcon, ListIcon, RecycleBinIcon, SettingsIcon } from "@/components/icons";
import type { ViewMode } from "@/types";

type PathBarActionsProps = {
  viewMode: ViewMode;
  settingsOpen: boolean;
  showRecycleBinButton: boolean;
  onViewChange: (mode: ViewMode) => void;
  onToggleSettings: () => void;
  onOpenRecycleBin: () => void;
};

export const PathBarActions = ({
  viewMode,
  settingsOpen,
  showRecycleBinButton,
  onViewChange,
  onToggleSettings,
  onOpenRecycleBin,
}: PathBarActionsProps) => {
  return (
    <div className="pathbar-actions">
      <TransferStatusButton />
      <div className="view-switch">
        {showRecycleBinButton ? (
          <ToolbarIconButton
            label="Recycle Bin"
            tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
            onClick={onOpenRecycleBin}
          >
            <RecycleBinIcon />
          </ToolbarIconButton>
        ) : null}
        <ToolbarIconButton
          label="List view"
          active={viewMode === "list"}
          pressed={viewMode === "list"}
          tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
          onClick={() => onViewChange("list")}
        >
          <ListIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="Thumbnails view"
          active={viewMode === "thumbs"}
          pressed={viewMode === "thumbs"}
          tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
          onClick={() => onViewChange("thumbs")}
        >
          <GridIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label="Settings"
          active={settingsOpen}
          pressed={settingsOpen}
          tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
          onClick={onToggleSettings}
        >
          <SettingsIcon />
        </ToolbarIconButton>
      </div>
    </div>
  );
};
