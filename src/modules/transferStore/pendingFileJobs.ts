// Pending source paths are kept per job so completing one job cannot free a
// path that a second, queued operation still needs.
import { normalizePath } from "@/lib/paths";
import type { TransferStoreState } from "../transferStore.types";

export type SettledFilePaths = ReadonlyMap<string, ReadonlySet<string>>;

export const removeSettledFilePaths = (
  jobs: TransferStoreState["pendingFileJobs"],
  settled: SettledFilePaths,
) => {
  let nextJobs = jobs;
  for (const [id, completed] of settled) {
    const job = jobs[id];
    if (!job) continue;

    const paths = new Set(job.paths);
    for (const path of completed) {
      const key = normalizePath(path);
      if (key) paths.delete(key);
    }
    if (paths.size === job.paths.size) continue;
    if (nextJobs === jobs) nextJobs = { ...jobs };
    if (paths.size === 0) delete nextJobs[id];
    else nextJobs[id] = { ...job, paths };
  }
  return nextJobs;
};

const EMPTY_PATHS = new Set<string>();

const combinePaths = (sets: Set<string>[]) => {
  if (sets.length <= 1) return sets[0] ?? EMPTY_PATHS;
  const combined = new Set<string>();
  for (const paths of sets) {
    for (const path of paths) combined.add(path);
  }
  return combined;
};

export const collectPendingFilePaths = (jobs: TransferStoreState["pendingFileJobs"]) => {
  const deleteSets: Set<string>[] = [];
  const transferSets: Set<string>[] = [];
  for (const job of Object.values(jobs)) {
    (job.kind === "delete" ? deleteSets : transferSets).push(job.paths);
  }
  return {
    pendingDeletePaths: combinePaths(deleteSets),
    pendingTransferPaths: combinePaths(transferSets),
  };
};
