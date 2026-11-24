// Navigation controls row that sits above the inputs.
import type { MouseEvent, ReactNode } from "react";
import type { TabHistoryDirection } from "@/types/tabs";
import { PressButton } from "@/components/primitives/PressButton";
import { WindowChromeBar } from "@/components/primitives/WindowChromeBar";
import { ChevronDownIcon, ChevronUpIcon, NavArrowIcon } from "@/components/icons";

type PathBarProps = {
  onBack: () => void;
  onForward: () => void;
  onHistoryMenu: (event: MouseEvent<HTMLButtonElement>, direction: TabHistoryDirection) => void;
  onUp: () => void;
  onDown: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  canGoDown: boolean;
  showFolderChevrons: boolean;
  leftSlot?: ReactNode;
  driveSlot?: ReactNode;
  rightSlot?: ReactNode;
  windowControlsSlot?: ReactNode;
};

export const PathBar = ({
  onBack,
  onForward,
  onHistoryMenu,
  onUp,
  onDown,
  canGoBack,
  canGoForward,
  canGoUp,
  canGoDown,
  showFolderChevrons,
  leftSlot,
  driveSlot,
  rightSlot,
  windowControlsSlot,
}: PathBarProps) => {
  const leftContent = leftSlot ? <div className="pathbar-left">{leftSlot}</div> : null;
  const centerContent = (
    <>
      <div className="path-controls">
        <PressButton
          type="button"
          className="btn ghost"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Back"
          aria-haspopup="menu"
          onContextMenu={(event) => onHistoryMenu(event, "back")}
        >
          <NavArrowIcon className="btn-icon nav-arrow is-back" />
        </PressButton>
        <PressButton
          type="button"
          className="btn ghost"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Forward"
          aria-haspopup="menu"
          onContextMenu={(event) => onHistoryMenu(event, "forward")}
        >
          <NavArrowIcon className="btn-icon nav-arrow" />
        </PressButton>
        {showFolderChevrons ? (
          <>
            <PressButton
              type="button"
              className="btn ghost"
              onClick={onUp}
              disabled={!canGoUp}
              aria-label="Up one level"
            >
              <ChevronUpIcon className="btn-icon" />
            </PressButton>
            <PressButton
              type="button"
              className="btn ghost"
              onClick={onDown}
              disabled={!canGoDown}
              aria-label="Down one level"
            >
              <ChevronDownIcon className="btn-icon" />
            </PressButton>
          </>
        ) : null}
      </div>
      {driveSlot ? <div className="pathbar-drive">{driveSlot}</div> : null}
    </>
  );
  const rightContent = rightSlot ? <div className="pathbar-right">{rightSlot}</div> : null;

  return (
    <WindowChromeBar
      shellClassName="pathbar-shell"
      dragRegionClassName="pathbar"
      leftSlot={leftContent}
      centerSlot={centerContent}
      rightSlot={rightContent}
      windowControlsSlot={windowControlsSlot}
    />
  );
};
