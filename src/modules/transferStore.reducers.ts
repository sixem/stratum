// Focused transfer-store transitions are implemented in dedicated modules.
// This file stays as a stable import surface for the Zustand store wiring.
export { clearFinishedJobsTransition } from "./transferStore/cleanupTransitions";
export {
  failLocalJobTransition,
  completeLocalJobTransition,
  startLocalJobTransition,
  updateLocalJobLabelTransition,
  updateLocalJobProgressTransition,
} from "./transferStore/localTransitions";
export {
  recordJobOutcomeTransition,
  registerJobMetadataTransition,
  updateJobLabelTransition,
} from "./transferStore/metadataTransitions";
export { applyProgressHintTransition } from "./transferStore/progressTransitions";
export { applyQueueSnapshotTransition } from "./transferStore/snapshotTransitions";
export { buildTransferJobCapabilities } from "./transferStore/shared";
