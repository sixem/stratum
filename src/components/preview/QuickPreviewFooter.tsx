// Gallery metadata and controls for the preview list and returning to the file view.
import type { RefObject } from "react";
import { PanelRightCloseIcon, PanelRightOpenIcon, ReturnIcon } from "@/components/icons/contextMenuIcons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type QuickPreviewFooterProps = {
  preview: {
    kind: "image" | "video" | "audio";
    typeLabel: string;
    dimensionLabel: string;
    sizeLabel: string;
    modifiedLabel: string;
    zoomLabel: string;
  };
  stripOpen: boolean;
  stripId: string;
  returnButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleStrip: () => void;
  onClose: () => void;
};

export const QuickPreviewFooter = ({
  preview,
  stripOpen,
  stripId,
  returnButtonRef,
  onToggleStrip,
  onClose,
}: QuickPreviewFooterProps) => {
  const toggleLabel = stripOpen ? "Hide preview list" : "Show preview list";
  const StripIcon = stripOpen ? PanelRightCloseIcon : PanelRightOpenIcon;

  return (
    <footer className="statusbar quick-preview-info">
      <div className="quick-preview-info-row" aria-live="polite">
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Type</span>
          <span className="quick-preview-info-value">{preview.typeLabel}</span>
        </div>
        {preview.kind !== "audio" ? <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Dimensions</span>
          <span className="quick-preview-info-value tnum">{preview.dimensionLabel}</span>
        </div> : null}
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Size</span>
          <span className="quick-preview-info-value tnum">{preview.sizeLabel}</span>
        </div>
        <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Modified</span>
          <span className="quick-preview-info-value tnum">{preview.modifiedLabel}</span>
        </div>
        {preview.kind !== "audio" ? <div className="quick-preview-info-item">
          <span className="quick-preview-info-label">Zoom</span>
          <span className="quick-preview-info-value tnum">{preview.zoomLabel}</span>
        </div> : null}
      </div>
      <div className="quick-preview-info-actions">
        <TooltipWrapper text={toggleLabel}>
          <button
            type="button"
            className="quick-preview-info-action"
            aria-label={toggleLabel}
            aria-controls={stripId}
            aria-expanded={stripOpen}
            onClick={onToggleStrip}
          >
            <StripIcon />
          </button>
        </TooltipWrapper>
        <TooltipWrapper text="Exit Gallery">
          <button type="button" className="quick-preview-info-action" ref={returnButtonRef}
            aria-label="Exit Gallery" onClick={onClose}>
            <ReturnIcon />
          </button>
        </TooltipWrapper>
      </div>
    </footer>
  );
};
