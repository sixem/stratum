// Renders a single transfer row for the status popover.
// Keeps the button component focused on layout and interaction.
import { buildTransferItemView } from "@/components/transfer/transferStatusView";
import type { TransferJob } from "@/modules/transferStore";

type TransferStatusItemProps = {
  job: TransferJob;
  now: number;
};

export const TransferStatusItem = ({ job, now }: TransferStatusItemProps) => {
  const view = buildTransferItemView(job, now);
  const progressValue =
    view.indeterminate ? undefined : view.progressPercentValue ?? undefined;
  const progressText = view.progressPercentText ?? view.statusLabel;

  return (
    <div
      className={`transfer-item transfer-item-${view.status}`}
      role="listitem"
    >
      <div className="transfer-item-header">
        <div className="transfer-item-title">{view.label}</div>
        <div className="transfer-item-count tnum">{view.countLabel}</div>
      </div>
      {view.fileName ? (
        <div className="transfer-item-file">
          <span className="transfer-item-file-label">{view.fileLabel}:</span>
          <span className="transfer-item-file-name">{view.fileName}</span>
        </div>
      ) : null}
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
      <div className="transfer-item-meta tnum">
        <span>{view.statusLabel}</span>
        <span>{view.rateLabel ?? ""}</span>
      </div>
    </div>
  );
};
