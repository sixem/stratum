// Compact transfer status button with a lightweight popover list.
// Uses a small view-model layer so the UI stays readable.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNowTick } from "@/hooks";
import { useTransferStore } from "@/modules";
import { TransferStatusItem } from "./TransferStatusItem";
import { buildTransferSummary } from "./transferStatusView";
import { PressButton } from "./PressButton";

export const TransferStatusButton = () => {
  const jobs = useTransferStore((state) => state.jobs);
  const clearAll = useTransferStore((state) => state.clearAll);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const summary = useMemo(() => buildTransferSummary(jobs), [jobs]);
  const canClear = !summary.hasActive && jobs.length > 0;
  // Keep timing labels fresh when the popover is open or transfers are running.
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
        <span className="transfer-label">Transfers</span>
        <span className="transfer-count tnum">{summary.countLabel}</span>
      </PressButton>
      {open ? (
        <div
          className="transfer-popover"
          role="dialog"
          aria-label="Transfers"
          aria-modal="false"
          id={popoverId}
          ref={popoverRef}
          tabIndex={-1}
        >
          <div className="transfer-popover-title">{summary.title}</div>
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
          {/* Keep this as a footer action so users can dismiss old entries quickly. */}
          <div className="transfer-popover-actions">
            <PressButton
              type="button"
              className="transfer-clear-button"
              onClick={() => {
                clearAll();
                setOpen(false);
              }}
              disabled={!canClear}
              title={
                canClear ? "Clear transfer log" : "Wait until active transfers are done"
              }
            >
              Clear transfer log
            </PressButton>
          </div>
        </div>
      ) : null}
    </div>
  );
};
