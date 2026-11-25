// Action cluster aligned to the right side of the path bar.
import { useEffect, useRef, useState } from "react";
import loader from "@/assets/icons/loaders/ring.svg";
import { hideBottomPane, showBottomPane, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { PATHBAR_TOOLTIP_DELAY_MS } from "@/constants";
import { TransferStatusButton } from "@/components/transfer/TransferStatusButton";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { GridIcon, ListIcon, RecycleBinIcon, SettingsIcon } from "@/components/icons";
import type { TransferDestination, ViewMode } from "@/types";

const RECYCLE_BIN_LOADER_DELAY_MS = 1000;

type PathBarActionsProps = {
  viewMode: ViewMode;
  settingsOpen: boolean;
  showRecycleBinButton: boolean;
  onViewChange: (mode: ViewMode) => void;
  onToggleSettings: () => void;
  onOpenRecycleBin: () => Promise<void>;
  onOpenJobDestination: (destination: TransferDestination) => void;
};

export const PathBarActions = ({
  viewMode,
  settingsOpen,
  showRecycleBinButton,
  onViewChange,
  onToggleSettings,
  onOpenRecycleBin,
  onOpenJobDestination,
}: PathBarActionsProps) => {
  const split = useBottomPaneStore(state => state.open);
  const [recycleBinState, setRecycleBinState] = useState<"idle" | "pending" | "loading">("idle");
  const recycleBinRequest = useRef<number | null>(null);
  const openingRecycleBin = recycleBinState !== "idle";

  useEffect(() => () => {
    const timer = recycleBinRequest.current;
    if (timer !== null) window.clearTimeout(timer);
    recycleBinRequest.current = null;
  }, []);

  const handleOpenRecycleBin = async () => {
    if (recycleBinRequest.current !== null) return;
    const timer = window.setTimeout(() => {
      if (recycleBinRequest.current === timer) setRecycleBinState("loading");
    }, RECYCLE_BIN_LOADER_DELAY_MS);
    recycleBinRequest.current = timer;
    setRecycleBinState("pending");
    try {
      await onOpenRecycleBin();
    } finally {
      window.clearTimeout(timer);
      if (recycleBinRequest.current === timer) {
        recycleBinRequest.current = null;
        setRecycleBinState("idle");
      }
    }
  };

  return (
    <div className="pathbar-actions">
      <TransferStatusButton onOpenDestination={onOpenJobDestination} />
      <div className="view-switch">
        <ToolbarIconButton
          label={split ? "Hide bottom pane" : "Show bottom pane"}
          active={split} pressed={split} tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
          onClick={() => split ? hideBottomPane() : showBottomPane()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" /><path d="M3 14h18" />
          </svg>
        </ToolbarIconButton>
        {showRecycleBinButton ? (
          <ToolbarIconButton
            label={openingRecycleBin ? "Opening Recycle Bin…" : "Recycle Bin"}
            tooltipDelayMs={PATHBAR_TOOLTIP_DELAY_MS}
            disabled={openingRecycleBin}
            onClick={() => void handleOpenRecycleBin()}
          >
            {recycleBinState === "loading" ? (
              <img className="recycle-bin-loader" src={loader} alt="" width={14} height={14} />
            ) : <RecycleBinIcon />}
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
