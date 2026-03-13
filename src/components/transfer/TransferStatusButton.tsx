// Compact work-log status button with a lightweight popover list.
// Uses a small view-model layer so the UI stays readable.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNowTick } from "@/hooks";
import { useTransferStore } from "@/modules";
import { WorkLogClearIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { TransferStatusItem } from "@/components/transfer/TransferStatusItem";
import { buildTransferSummary } from "@/components/transfer/transferStatusView";
import { PressButton } from "@/components/primitives/PressButton";

export const TransferStatusButton = () => {
  const jobs = useTransferStore((state) => state.jobs);
  const clearFinishedJobs = useTransferStore((state) => state.clearFinishedJobs);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const summary = useMemo(() => buildTransferSummary(jobs), [jobs]);
  const canClear = summary.hasFinished;
  const clearTooltipText = canClear
    ? `Clear ${summary.finishedCount} finished job${summary.finishedCount === 1 ? "" : "s"}`
    : "No finished jobs to clear";
  // Keep timing labels fresh when the popover is open or work is running.
  const now = useNowTick({ enabled: open || summary.hasActive });

  useEffect(() => {
    if (jobs.length === 0 && open) {
      setOpen(false);
    }
  }, [jobs.length, open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.focus();
  }, [open]);

  if (jobs.length === 0) return null;

  return (
    <div className="transfer-status tnum" ref={containerRef}>
      <PressButton
        type="button"
        className={`transfer-button${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((prev) => !prev)}
        ref={buttonRef}
      >
        <span
          className={`transfer-indicator${summary.hasActive ? " is-active" : " is-complete"}`}
          aria-hidden="true"
        />
        <span className="transfer-label">Work</span>
        <span className="transfer-count tnum">{summary.countLabel}</span>
      </PressButton>
      {open ? (
        <div
          className="transfer-popover"
          role="dialog"
          aria-label="Work log"
          aria-modal="false"
          id={popoverId}
          ref={popoverRef}
          tabIndex={-1}
        >
          <div className="transfer-popover-header">
            <div className="transfer-popover-title">{summary.title}</div>
            <TooltipWrapper text={clearTooltipText}>
              <span className="transfer-popover-clear-shell">
                <PressButton
                  type="button"
                  className="transfer-popover-clear"
                  onClick={() => {
                    clearFinishedJobs();
                  }}
                  disabled={!canClear}
                  aria-label="Clear finished jobs"
                >
                  <WorkLogClearIcon />
                </PressButton>
              </span>
            </TooltipWrapper>
          </div>
          <div className="transfer-list" role="list">
            {jobs.map((job) => (
              <TransferStatusItem key={job.id} job={job} now={now} />
            ))}
          </div>
          {summary.latestJob?.failures ? (
            <div className="transfer-popover-note tnum">
              {summary.latestJob.failures} failed item
              {summary.latestJob.failures === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
