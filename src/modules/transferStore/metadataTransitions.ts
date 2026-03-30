// Transfer metadata transitions.
// These helpers keep per-job labels and outcome summaries in sync with visible jobs.
import type { TransferJobMetadata, TransferStoreState } from "../transferStore.types";
import {
  normalizeItems,
  patchJob,
  updateJobCollections,
} from "./shared";

export const registerJobMetadataTransition = (
  state: TransferStoreState,
  id: string,
  input: { label: string; items?: string[] },
): TransferStoreState => {
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        label: input.label,
        items: normalizeItems(input.items),
      },
    },
  };
};

export const updateJobLabelTransition = (
  state: TransferStoreState,
  id: string,
  label: string,
): TransferStoreState => {
  const nextCollections = updateJobCollections(state, id, (job) => patchJob(job, { label }));
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        label,
      },
    },
    ...nextCollections,
  };
};

export const recordJobOutcomeTransition = (
  state: TransferStoreState,
  id: string,
  patch: Partial<Pick<TransferJobMetadata, "copied" | "moved" | "skipped" | "failures">>,
): TransferStoreState => {
  const nextCollections = updateJobCollections(state, id, (job) => patchJob(job, patch));
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        ...patch,
      },
    },
    ...nextCollections,
  };
};
