// Decorative background progress for the header's Work button.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TransferJob } from "@/modules/transferStore.types";
import { advanceWorkPillProgress, WORK_PILL_FADE_MS } from "./workPillProgress";
import type { WorkPillProgress } from "./workPillProgress";

export const WorkPillFill = ({ jobs }: { jobs: TransferJob[] }) => {
  const latestJobs = useRef(jobs);
  const [progress, setProgress] = useState<WorkPillProgress | null>(() => advanceWorkPillProgress(null, jobs, 0));
  const deadline = progress?.transition?.until;

  useLayoutEffect(() => {
    latestJobs.current = jobs;
    const now = performance.now();
    setProgress((current) => advanceWorkPillProgress(current, jobs, now));
  }, [jobs]);

  useEffect(() => {
    if (deadline === undefined) return;
    const timeout = window.setTimeout(() => {
      const now = performance.now();
      setProgress((current) => advanceWorkPillProgress(current, latestJobs.current, now));
    }, Math.max(0, Math.ceil(deadline - performance.now())));
    return () => window.clearTimeout(timeout);
  }, [deadline]);

  if (!progress) return null;
  return (
    <span
      key={progress.jobId}
      className="work-pill-fill"
      data-phase={progress.transition?.phase}
      style={{
        transform: `scaleX(${progress.fraction})`,
        "--work-pill-fade-duration": `${WORK_PILL_FADE_MS}ms`,
      } as CSSProperties}
      aria-hidden="true"
    />
  );
};
