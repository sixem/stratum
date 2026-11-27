// Keeps the active batch rename tied to the pane that started it.
import { createWithEqualityFn } from "zustand/traditional";
import type { BatchRenameRequest } from "@/lib/batchRename";
import type { EntryContextTarget } from "@/types";

type BatchRenameSession = {
  items: readonly EntryContextTarget[];
  onApply: (requests: BatchRenameRequest[]) => Promise<void>;
  remote?: boolean;
  onValidate?: (requests: BatchRenameRequest[]) => Promise<ReadonlyMap<string, string>>;
};

type BatchRenameStore = {
  session: BatchRenameSession | null;
  open: (session: BatchRenameSession) => void;
  close: (session: BatchRenameSession) => void;
};

export const useBatchRenameStore = createWithEqualityFn<BatchRenameStore>((set, get) => ({
  session: null,
  open: (session) => {
    if (!get().session) set({ session });
  },
  close: (session) => {
    if (get().session === session) set({ session: null });
  },
}));
