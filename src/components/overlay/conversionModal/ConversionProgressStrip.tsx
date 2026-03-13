// Queue/submit summary card for the conversion modal.
import type { RefObject } from "react";
import { PressButton } from "@/components/primitives";

type ConversionProgressStripProps = {
  tone: "idle" | "running" | "completed" | "failed" | "warning";
  activeMessage: string | null;
  cancelButtonRef: RefObject<HTMLButtonElement | null>;
  secondaryActionLabel: string;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  onClose: () => void;
  onPrimaryAction: () => void;
};

export const ConversionProgressStrip = ({
  tone,
  activeMessage,
  cancelButtonRef,
  secondaryActionLabel,
  primaryActionLabel,
  primaryActionDisabled,
  onClose,
  onPrimaryAction,
}: ConversionProgressStripProps) => {
  return (
    <div className={`conversion-progress-strip is-${tone}`}>
      <div className="conversion-progress-bottom">
        {activeMessage ? (
            <div className="conversion-progress-detail">{activeMessage}</div>
        ) : (
          <div className="conversion-progress-detail" />
        )}
        <div className="conversion-progress-footer">
          <PressButton
            ref={cancelButtonRef}
            type="button"
            className="btn ghost"
            onClick={onClose}
          >
            {secondaryActionLabel}
          </PressButton>
          <PressButton
            type="button"
            className="btn conversion-primary-btn"
            onClick={onPrimaryAction}
            disabled={primaryActionDisabled}
          >
            {primaryActionLabel}
          </PressButton>
        </div>
      </div>
    </div>
  );
};
