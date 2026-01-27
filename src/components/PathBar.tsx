// Navigation controls row that sits above the inputs.
import type { ReactNode } from "react";
import { ChevronUpIcon, NavArrowIcon } from "./Icons";

type PathBarProps = {
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  loading: boolean;
  leftSlot?: ReactNode;
  driveSlot?: ReactNode;
  rightSlot?: ReactNode;
};

export function PathBar({
  onBack,
  onForward,
  onUp,
  canGoBack,
  canGoForward,
  canGoUp,
  loading,
  leftSlot,
  driveSlot,
  rightSlot,
}: PathBarProps) {
  return (
    <div className="pathbar">
      {leftSlot ? <div className="pathbar-left">{leftSlot}</div> : null}
      <div className="path-controls">
        <button
          type="button"
          className="btn ghost"
          onClick={onBack}
          disabled={loading || !canGoBack}
          aria-disabled={loading || !canGoBack}
          aria-label="Back"
        >
          <NavArrowIcon className="btn-icon nav-arrow is-back" />
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onForward}
          disabled={loading || !canGoForward}
          aria-disabled={loading || !canGoForward}
          aria-label="Forward"
        >
          <NavArrowIcon className="btn-icon nav-arrow" />
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onUp}
          disabled={loading || !canGoUp}
          aria-disabled={loading || !canGoUp}
          aria-label="Up one level"
        >
          <ChevronUpIcon className="btn-icon" />
        </button>
      </div>
      {driveSlot ? <div className="pathbar-drive">{driveSlot}</div> : null}
      {rightSlot ? <div className="pathbar-right">{rightSlot}</div> : null}
    </div>
  );
}
