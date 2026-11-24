// Gallery metadata and the disclosure control for its file list.
import type { RefObject } from "react";
import { ContextChevronRightIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type QuickPreviewFooterProps = {
  preview: {
    typeLabel: string;
    dimensionLabel: string;
    sizeLabel: string;
    modifiedLabel: string;
    zoomLabel: string;
  };
  stripOpen: boolean;
  stripId: string;
  stripToggleRef: RefObject<HTMLButtonElement | null>;
  onToggleStrip: () => void;
};

export const QuickPreviewFooter = ({
  preview,
  stripOpen,
  stripId,
  stripToggleRef,
  onToggleStrip,
}: QuickPreviewFooterProps) => {
  const toggleLabel = stripOpen ? "Hide preview list" : "Show preview list";

  return (
    <footer className="statusbar quick-preview-info">
      <div className="quick-preview-info-row" aria-live="polite">
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Type</span>
          <span className="quick-preview-info-value">{preview.typeLabel}</span>
        </div>
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Dimensions</span>
          <span className="quick-preview-info-value tnum">{preview.dimensionLabel}</span>
        </div>
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Size</span>
          <span className="quick-preview-info-value tnum">{preview.sizeLabel}</span>
        </div>
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Modified</span>
          <span className="quick-preview-info-value tnum">{preview.modifiedLabel}</span>
        </div>
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Zoom</span>
          <span className="quick-preview-info-value tnum">{preview.zoomLabel}</span>
        </div>
      </div>
      <TooltipWrapper text="Toggle preview list">
        <button
          type="button"
          className="quick-preview-strip-toggle"
          ref={stripToggleRef}
          aria-label={toggleLabel}
          aria-controls={stripId}
          aria-expanded={stripOpen}
          onClick={onToggleStrip}
          onKeyDown={(event) => {
            // Let the button activate without triggering gallery close or video playback.
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          <ContextChevronRightIcon className="quick-preview-strip-chevron" />
        </button>
      </TooltipWrapper>
    </footer>
  );
};
