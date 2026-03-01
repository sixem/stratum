// Navigation controls row that sits above the inputs.
import type { ReactNode } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { WindowChromeBar } from "@/components/primitives/WindowChromeBar";
import { ChevronDownIcon, ChevronUpIcon, NavArrowIcon } from "@/components/icons";

type PathBarProps = {
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onDown: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  canGoDown: boolean;
  loading: boolean;
  leftSlot?: ReactNode;
  driveSlot?: ReactNode;
  rightSlot?: ReactNode;
  windowControlsSlot?: ReactNode;
};

export const PathBar = ({
  onBack,
  onForward,
  onUp,
  onDown,
  canGoBack,
  canGoForward,
  canGoUp,
  canGoDown,
  loading,
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
          disabled={loading || !canGoBack}
          aria-disabled={loading || !canGoBack}
          aria-label="Back"
        >
          <NavArrowIcon className="btn-icon nav-arrow is-back" />
        </PressButton>
        <PressButton
          type="button"
          className="btn ghost"
          onClick={onForward}
          disabled={loading || !canGoForward}
          aria-disabled={loading || !canGoForward}
          aria-label="Forward"
        >
          <NavArrowIcon className="btn-icon nav-arrow" />
        </PressButton>
        <PressButton
          type="button"
          className="btn ghost"
          onClick={onUp}
          disabled={loading || !canGoUp}
          aria-disabled={loading || !canGoUp}
          aria-label="Up one level"
        >
          <ChevronUpIcon className="btn-icon" />
        </PressButton>
        <PressButton
          type="button"
          className="btn ghost"
          onClick={onDown}
          disabled={loading || !canGoDown}
          aria-disabled={loading || !canGoDown}
          aria-label="Down one level"
        >
          <ChevronDownIcon className="btn-icon" />
        </PressButton>
      </div>
      {driveSlot ? <div className="pathbar-drive">{driveSlot}</div> : null}
    </>
  );
  const rightContent = rightSlot ? <div className="pathbar-right">{rightSlot}</div> : null;

  return (
    <WindowChromeBar
      shellClassName="pathbar-shell"
      dragRegionClassName="pathbar"
      windowControlsClassName="pathbar-window-controls"
      leftSlot={leftContent}
      centerSlot={centerContent}
      rightSlot={rightContent}
      windowControlsSlot={windowControlsSlot}
    />
  );
};
