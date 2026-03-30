// Transfer UI state backed by backend queue snapshots.
// The store keeps backend and local sources separate, and derives the merged view for the UI.
import { useMemo } from "react";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import type {
  TransferJobsSnapshotEvent,
  TransferProgressEvent,
  TransferQueueSnapshot,
} from "@/types";
import {
  applyProgressHintTransition,
  applyQueueSnapshotTransition,
  clearFinishedJobsTransition,
  completeLocalJobTransition,
  failLocalJobTransition,
  recordJobOutcomeTransition,
  registerJobMetadataTransition,
  startLocalJobTransition,
  updateJobLabelTransition,
  updateLocalJobLabelTransition,
  updateLocalJobProgressTransition,
} from "./transferStore.reducers";
import { mergeVisibleJobs } from "./transferStore.selectors";
import type {
  TransferJob,
  TransferJobMetadata,
  TransferJobRegistration,
  TransferStoreState,
} from "./transferStore.types";

export type {
  TransferJob,
  TransferJobMetadata,
  TransferJobRegistration,
  TransferStatus,
  TransferStoreState,
} from "./transferStore.types";
export { selectTransferJobs } from "./transferStore.selectors";

type TransferStore = TransferStoreState & {
  startJob: (input: { label: string; total: number; items?: string[] }) => TransferJob;
  updateProgress: (
    id: string,
    update: {
      processed: number;
      total?: number;
      currentPath?: string | null;
      currentBytes?: number | null;
      currentTotalBytes?: number | null;
      progressPercent?: number | null;
      statusText?: string | null;
      rateText?: string | null;
    },
  ) => void;
  updateLabel: (id: string, label: string) => void;
  completeJob: (id: string, patch?: Partial<TransferJob>) => void;
  failJob: (id: string, patch?: Partial<TransferJob>) => void;
  registerJob: (input: { label: string; items?: string[] }) => TransferJobRegistration;
  updateJobLabel: (id: string, label: string) => void;
  recordJobOutcome: (
    id: string,
    patch: Partial<Pick<TransferJobMetadata, "copied" | "moved" | "skipped" | "failures">>,
  ) => void;
  applyQueueSnapshot: (snapshot: TransferQueueSnapshot | TransferJobsSnapshotEvent) => void;
  applyProgressHint: (event: TransferProgressEvent) => void;
  clearFinishedJobs: () => void;
};

const createTransferId = () => {
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const DEFAULT_TRANSFER_STORE_STATE: TransferStoreState = {
  backendJobs: [],
  localJobs: [],
  jobMetadata: {},
  dismissedJobIds: {},
};

export const useTransferStore = createWithEqualityFn<TransferStore>((set) => ({
  ...DEFAULT_TRANSFER_STORE_STATE,
  startJob: ({ label, total, items }) => {
    const now = Date.now();
    const { job, state } = startLocalJobTransition(
      useTransferStore.getState(),
      {
        id: createTransferId(),
        label,
        total,
        items,
      },
      now,
    );
    set(state);
    return job;
  },
  updateProgress: (id, update) =>
    set((state) => updateLocalJobProgressTransition(state, id, update, Date.now())),
  updateLabel: (id, label) =>
    set((state) => updateLocalJobLabelTransition(state, id, label)),
  completeJob: (id, patch) =>
    set((state) => completeLocalJobTransition(state, id, patch, Date.now())),
  failJob: (id, patch) =>
    set((state) => failLocalJobTransition(state, id, patch, Date.now())),
  registerJob: ({ label, items }) => {
    const id = createTransferId();
    set((state) => registerJobMetadataTransition(state, id, { label, items }));
    return { id };
  },
  updateJobLabel: (id, label) =>
    set((state) => updateJobLabelTransition(state, id, label)),
  recordJobOutcome: (id, patch) =>
    set((state) => recordJobOutcomeTransition(state, id, patch)),
  applyQueueSnapshot: (snapshot) =>
    set((state) => applyQueueSnapshotTransition(state, snapshot, Date.now())),
  applyProgressHint: (event) =>
    set((state) => applyProgressHintTransition(state, event, Date.now())),
  clearFinishedJobs: () =>
    set((state) => clearFinishedJobsTransition(state)),
}));

export const useTransferJobs = () => {
  const { backendJobs, localJobs } = useTransferStore(
    (state) => ({
      backendJobs: state.backendJobs,
      localJobs: state.localJobs,
    }),
    shallow,
  );

  return useMemo(() => mergeVisibleJobs(backendJobs, localJobs), [backendJobs, localJobs]);
};
