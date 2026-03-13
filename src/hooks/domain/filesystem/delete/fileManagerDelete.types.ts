// Shared types for delete/trash workflow helpers.
import type { PromptConfig } from "@/modules";
import type { DeleteReport, TrashReport, TransferReport } from "@/types";
import type { UndoAction } from "../fileManagerUndo";

export type DeletePromptApi = {
  showPrompt: (prompt: PromptConfig) => void;
};

export type ManagedDeleteOperations = {
  runManagedTrashEntries: (paths: string[]) => Promise<TrashReport>;
  runManagedDeleteEntries: (paths: string[]) => Promise<DeleteReport>;
  runManagedTrashMove: (
    paths: string[],
    destination: string,
  ) => Promise<TransferReport>;
};

export type DeleteFlowContext = {
  promptStore: DeletePromptApi;
  pushUndo: (action: UndoAction) => void;
  refreshAfterChange: () => Promise<void>;
};

export type TrashLocationHelpers = {
  resolveTrashRootForPath: (path: string) => Promise<string>;
  buildTrashBatchDir: (root: string) => string;
};
