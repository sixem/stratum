// Compact work-log status button with a lightweight popover list.
// Uses a small view-model layer so the UI stays readable.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSettingsStore, useTransferJobs, useTransferStore } from "@/modules";
import { WorkLogClearIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { ToolbarPopover } from "@/components/primitives/ToolbarPopover";
import type { TransferDestination } from "@/types";
import { TransferStatusList } from "./TransferStatusList";
import { buildTransferSummary } from "./transferStatusView";
import { WorkPillFill } from "./WorkPillFill";
import { refreshRecovery, useRecovery } from "@/modules/remoteRecovery";

export const TransferStatusButton = ({
  onOpenDestination,
}: { onOpenDestination: (destination: TransferDestination) => void }) => {
  const jobs = useTransferJobs();
  const showWorkProgressFill = useSettingsStore((state) => state.showWorkProgressFill);
  const clearFinishedJobs = useTransferStore((state) => state.clearFinishedJobs);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const summary = useMemo(() => buildTransferSummary(jobs), [jobs]);
  const canClear = summary.hasFinished;
  const recoveryCount = useRecovery(s => s.details.length);
  const recoveryError = useRecovery(s => Boolean(s.error));
  const hasWork = jobs.length > 0 || recoveryCount > 0 || recoveryError;
  useEffect(() => { void refreshRecovery(); }, [open]);
  const clearTooltipText = canClear
    ? `Clear ${summary.finishedCount} finished job${summary.finishedCount === 1 ? "" : "s"}`
    : "No finished jobs to clear";

  useEffect(() => {
    if (!hasWork && open) {
      setOpen(false);
    }
  }, [hasWork, open]);

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

  if (!hasWork) return null;

  return (
    <div className="transfer-status" ref={containerRef}>
      <PressButton
        type="button"
        className={`transfer-button${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((prev) => !prev)}
        ref={buttonRef}
      >
        {showWorkProgressFill ? <WorkPillFill jobs={jobs} /> : null}
        <span
          className={`transfer-indicator${summary.hasActive ? " is-active" : " is-complete"}`}
          aria-hidden="true"
        />
        <span className="transfer-label">Work</span>
        <span className="transfer-count tnum">{[jobs.length ? summary.countLabel : "", recoveryCount ? `${recoveryCount} to review` : recoveryError ? "Recovery unavailable" : ""].filter(Boolean).join(" · ")}</span>
      </PressButton>
      {open ? (
        // The title bar passes pointer events through decorative elements.
        // Keep both the panel and its native scrollbar interactive.
        <ToolbarPopover
          className="transfer-popover"
          role="dialog"
          aria-label="Work log"
          aria-modal="false"
          id={popoverId}
          ref={popoverRef}
          tabIndex={-1}
          heading={jobs.length ? summary.title : "Work"}
          headerAction={(
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
          )}
          footer={summary.latestJob?.failures ? (
            <div className="transfer-popover-note tnum">
              {summary.latestJob.failures} failed item
              {summary.latestJob.failures === 1 ? "" : "s"}
            </div>
          ) : null}
        >
          <TransferStatusList
            jobs={jobs}
            onOpenDestination={(destination) => {
              setOpen(false);
              onOpenDestination(destination);
            }}
          />
        </ToolbarPopover>
      ) : null}
    </div>
  );
};
