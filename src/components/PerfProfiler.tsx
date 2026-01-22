// Lightweight React Profiler wrapper that logs commit durations.
import { Profiler } from "react";
import type { PropsWithChildren, ProfilerOnRenderCallback } from "react";
import { makeDebug } from "@/lib";

type PerfProfilerProps = PropsWithChildren<{
  id: string;
}>;

const log = makeDebug("perf:react");
// Avoid spamming tiny commits in perf logs.
const MIN_DURATION_MS = 8;

export const PerfProfiler = ({ id, children }: PerfProfilerProps) => {
  const onRender: ProfilerOnRenderCallback = (
    profilerId,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    if (!log.enabled) return;
    if (phase === "nested-update") return;
    if (actualDuration < MIN_DURATION_MS) return;
    log(
      "%s %s actual=%dms base=%dms start=%dms commit=%dms",
      profilerId,
      phase,
      Math.round(actualDuration),
      Math.round(baseDuration),
      Math.round(startTime),
      Math.round(commitTime),
    );
  };

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
};
