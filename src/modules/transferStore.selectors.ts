// Derived transfer views live here so the writable store only keeps source state.
import type { TransferJob, TransferStoreState } from "./transferStore.types";

export const mergeVisibleJobs = (backendJobs: TransferJob[], localJobs: TransferJob[]) => {
  return [...backendJobs, ...localJobs];
};

export const selectTransferJobs = (state: TransferStoreState) => {
  return mergeVisibleJobs(state.backendJobs, state.localJobs);
};
