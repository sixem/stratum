// Shared helpers for delete/trash workflow reporting and prompts.
import { getManagedJobErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { formatFailures, normalizePath } from "@/lib";
import type { DeletePromptApi } from "./fileManagerDelete.types";

type PromptPermanentDeleteFallbackOptions<T> = {
  promptStore: DeletePromptApi;
  title: string;
  reasons: string[];
  remainingPaths: string[];
  onConfirm: () => Promise<T>;
  onCancel: () => T;
};

export const buildDeleteReport = (
  deleted: number,
  skipped: number,
  cancelled: boolean,
  failures: string[],
) => ({
  deleted,
  skipped,
  cancelled,
  failures,
});

export const buildCountLabel = (count: number) =>
  count === 1 ? "this item" : `${count} items`;

export const showDeleteError = (
  promptStore: DeletePromptApi,
  error: unknown,
  fallback: string,
) => {
  promptStore.showPrompt({
    title: "Delete failed",
    content: getManagedJobErrorMessage(error, fallback),
    confirmLabel: "OK",
    cancelLabel: null,
  });
};

export const showDeleteIssues = (
  promptStore: DeletePromptApi,
  failures: string[],
) => {
  if (failures.length === 0) {
    return;
  }
  promptStore.showPrompt({
    title: "Delete completed with issues",
    content: formatFailures(failures),
    confirmLabel: "OK",
    cancelLabel: null,
  });
};

export const resolveRecycledPaths = (
  requestedPaths: string[],
  failedPaths: string[],
) => {
  const failedPathSet = new Set(failedPaths.map((path) => normalizePath(path)));
  return requestedPaths.filter(
    (path) => !failedPathSet.has(normalizePath(path)),
  );
};

export const promptPermanentDeleteFallback = <T>({
  promptStore,
  title,
  reasons,
  remainingPaths,
  onConfirm,
  onCancel,
}: PromptPermanentDeleteFallbackOptions<T>) =>
  new Promise<T>((resolve) => {
    promptStore.showPrompt({
      title,
      content: `${reasons.join("\n\n")}\n\nDelete ${buildCountLabel(remainingPaths.length)} permanently instead? This cannot be undone.`,
      confirmLabel: "Delete permanently",
      cancelLabel: "Cancel",
      onConfirm: async () => {
        resolve(await onConfirm());
      },
      onCancel: () => {
        resolve(onCancel());
      },
    });
  });
