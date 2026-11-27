// Renders a single transfer row for the status popover.
// Keeps the button component focused on layout and interaction.
import { buildTransferItemView } from "@/components/transfer/transferStatusView";
import { TransferStatusItemActions } from "@/components/transfer/TransferStatusItemActions";
import { useDisplayedTransferFileName } from "@/components/transfer/useDisplayedTransferFileName";
import type { TransferJob } from "@/modules/transferStore";
import type { TransferDestination } from "@/types";

type TransferStatusItemProps = {
  job: TransferJob;
  now: number;
  onOpenDestination: (destination: TransferDestination) => void;
};

export const TransferStatusItem = ({ job, now, onOpenDestination }: TransferStatusItemProps) => {
  const view = buildTransferItemView(job, now);
  const displayedFileName = useDisplayedTransferFileName({
    fileName: view.fileName,
    status: view.status,
  });
  const progressValue =
    view.indeterminate ? undefined : view.progressPercentValue ?? undefined;
  const progressText = view.indeterminate ? view.statusLabel : view.progressPercentText ?? view.statusLabel;

  return (
    <div
      className={`transfer-item transfer-item-${view.status}`}
      role="listitem"
    >
      <div className="transfer-item-header">
        <div className="transfer-item-title">{view.label}</div>
        <div className="transfer-item-header-side">
          <div className="transfer-item-count tnum">{view.countLabel}</div>
          <TransferStatusItemActions job={job} onOpenDestination={onOpenDestination} />
        </div>
      </div>
      {displayedFileName ? (
        <div className="transfer-item-file">
          <span className="transfer-item-file-label">{view.fileLabel}:</span>
          <span className="transfer-item-file-name">{displayedFileName}</span>
        </div>
      ) : null}
      {view.status === "completed" ? null : (
        <div
          className="transfer-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressValue}
          aria-valuetext={progressText}
          data-indeterminate={view.indeterminate ? "true" : "false"}
        >
          <div
            className="transfer-progress-fill"
            style={{ width: `${view.progress * 100}%` }}
          />
        </div>
      )}
      <div className="transfer-item-meta tnum">
        <span>{view.statusLabel}</span>
        <span>{view.rateLabel ?? ""}</span>
      </div>
    </div>
  );
};
