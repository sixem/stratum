// Transfer-row controls for backend-managed jobs.
// These stay separate from the main row layout so the item component remains readable.
import { useMemo, useState } from "react";
import { cancelTransferJob, pauseTransferJob, resumeTransferJob } from "@/api";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { usePromptStore } from "@/modules";
import type { TransferJob } from "@/modules/transferStore";

type TransferStatusItemActionsProps = {
  job: TransferJob;
};

type PendingOperationAction = "pause" | "resume" | "cancel" | null;

const getActionErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
};

const PauseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="2.5" width="3" height="11" rx="0.9" />
    <rect x="10" y="2.5" width="3" height="11" rx="0.9" />
  </svg>
);

const ResumeIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 2.8 12.6 8 4 13.2z" />
  </svg>
);

const CancelIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.2 4.2 7.6 7.6" />
    <path d="M11.8 4.2 4.2 11.8" />
  </svg>
);

export const TransferStatusItemActions = ({
  job,
}: TransferStatusItemActionsProps) => {
  const promptStore = useMemo(() => usePromptStore.getState(), []);
  const [pendingAction, setPendingAction] = useState<PendingOperationAction>(null);

  if (!job.backendManaged) {
    return null;
  }

  const showPause = job.capabilities.canPause && job.status === "running";
  const showResume = job.capabilities.canPause && job.status === "paused";
  const showCancel =
    job.capabilities.canCancel &&
    (job.status === "queued" ||
      job.status === "running" ||
      job.status === "paused");

  if (!showPause && !showResume && !showCancel) {
    return null;
  }

  const runAction = async (
    action: Exclude<PendingOperationAction, null>,
    request: (jobId: string) => Promise<boolean>,
    fallbackMessage: string,
  ) => {
    setPendingAction(action);
    try {
      await request(job.id);
    } catch (error) {
      promptStore.showPrompt({
        title: "Operation action failed",
        content: getActionErrorMessage(error, fallbackMessage),
        confirmLabel: "OK",
        cancelLabel: null,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const disableActions = pendingAction != null;

  return (
    <div className="transfer-item-actions" role="group" aria-label="Operation controls">
      {showPause ? (
        <TooltipWrapper text="Pause operation">
          <span className="transfer-item-action-shell">
            <PressButton
              type="button"
              className="transfer-item-action"
              onClick={() =>
                void runAction(
                  "pause",
                  pauseTransferJob,
                  "Unable to pause the active operation.",
                )
              }
              disabled={disableActions}
              aria-label="Pause operation"
            >
              <PauseIcon />
            </PressButton>
          </span>
        </TooltipWrapper>
      ) : null}
      {showResume ? (
        <TooltipWrapper text="Resume operation">
          <span className="transfer-item-action-shell">
            <PressButton
              type="button"
              className="transfer-item-action"
              onClick={() =>
                void runAction(
                  "resume",
                  resumeTransferJob,
                  "Unable to resume the active operation.",
                )
              }
              disabled={disableActions}
              aria-label="Resume operation"
            >
              <ResumeIcon />
            </PressButton>
          </span>
        </TooltipWrapper>
      ) : null}
      {showCancel ? (
        <TooltipWrapper text="Cancel operation">
          <span className="transfer-item-action-shell">
            <PressButton
              type="button"
              className="transfer-item-action transfer-item-action-danger"
              onClick={() =>
                void runAction(
                  "cancel",
                  cancelTransferJob,
                  "Unable to cancel the selected operation.",
                )
              }
              disabled={disableActions}
              aria-label="Cancel operation"
            >
              <CancelIcon />
            </PressButton>
          </span>
        </TooltipWrapper>
      ) : null}
    </div>
  );
};
