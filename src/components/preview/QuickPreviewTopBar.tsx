// Minimal title-bar chrome for quick preview with gallery navigation and window controls.
import { NavArrowIcon } from "@/components/icons";
import { WindowControls } from "@/components/navigation/WindowControls";
import { PressButton } from "@/components/primitives/PressButton";
import { WindowChromeBar } from "@/components/primitives/WindowChromeBar";

type QuickPreviewTopBarProps = {
  title: string;
  positionLabel?: string | null;
  showNavigation: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
};

export const QuickPreviewTopBar = ({
  title,
  positionLabel,
  showNavigation,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: QuickPreviewTopBarProps) => {
  const leftSlot = showNavigation ? (
    <div className="quick-preview-topbar-nav">
      <PressButton
        type="button"
        className="btn ghost"
        onClick={onGoBack}
        disabled={!canGoBack}
        aria-disabled={!canGoBack}
        aria-label="Previous preview item"
      >
        <NavArrowIcon className="btn-icon nav-arrow is-back" />
      </PressButton>
      <PressButton
        type="button"
        className="btn ghost"
        onClick={onGoForward}
        disabled={!canGoForward}
        aria-disabled={!canGoForward}
        aria-label="Next preview item"
      >
        <NavArrowIcon className="btn-icon nav-arrow" />
      </PressButton>
    </div>
  ) : null;
  const centerSlot = (
    <div className="quick-preview-topbar-title" title={title}>
      {title}
    </div>
  );
  const rightSlot = positionLabel ? (
    <div className="quick-preview-topbar-position" aria-label={`Preview position ${positionLabel}`}>
      {positionLabel}
    </div>
  ) : null;

  return (
    <WindowChromeBar
      shellClassName="quick-preview-topbar-shell"
      dragRegionClassName="quick-preview-topbar"
      windowControlsClassName="quick-preview-topbar-window-controls"
      leftSlot={leftSlot}
      centerSlot={centerSlot}
      rightSlot={rightSlot}
      windowControlsSlot={<WindowControls />}
    />
  );
};
