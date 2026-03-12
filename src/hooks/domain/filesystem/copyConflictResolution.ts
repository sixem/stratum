// Resolves copy conflicts before the backend starts copying.
// This keeps the native copy pass simple and lets the UI apply bulk decisions cleanly.
import { getParentPath, getPathName, normalizePath } from "@/lib";
import type { PromptConfig } from "@/modules/promptStore";
import type { CopyConflict } from "@/types";

export type CopyConflictResolution = {
  cancelled: boolean;
  overwritePaths: string[];
  skipPaths: string[];
};

type PromptStoreLike = {
  showPrompt: (prompt: PromptConfig) => void;
};

type CopyConflictDecision =
  | "overwrite"
  | "overwrite-all"
  | "skip"
  | "skip-all"
  | "cancel";

const buildCopyConflictMessage = (conflict: CopyConflict) => {
  const itemName = getPathName(conflict.destinationPath) || getPathName(conflict.sourcePath);
  const parentPath = getParentPath(conflict.destinationPath) ?? "";

  if (conflict.kind === "fileToFile") {
    return `A file named "${itemName}" already exists in ${parentPath}.`;
  }
  if (conflict.kind === "fileToDirectory") {
    return `A folder named "${itemName}" already exists in ${parentPath}, but the copied item is a file.`;
  }
  return `A file named "${itemName}" already exists in ${parentPath}, but the copied item is a folder.`;
};

const promptCopyConflictDecision = (
  promptStore: PromptStoreLike,
  conflict: CopyConflict,
  remaining: number,
) => {
  return new Promise<CopyConflictDecision>((resolve) => {
    const actions: NonNullable<PromptConfig["actions"]> = [
      {
        label: "Skip",
        onClick: () => resolve("skip"),
        variant: "ghost",
      },
    ];

    if (remaining > 1) {
      actions.push(
        {
          label: "Skip all",
          onClick: () => resolve("skip-all"),
          variant: "ghost",
        },
        {
          label: "Overwrite all",
          onClick: () => resolve("overwrite-all"),
          variant: "ghost",
        },
      );
    }

    promptStore.showPrompt({
      title: "Item already exists",
      content: buildCopyConflictMessage(conflict),
      confirmLabel: "Overwrite",
      cancelLabel: "Cancel",
      actions,
      onConfirm: () => resolve("overwrite"),
      onCancel: () => resolve("cancel"),
    });
  });
};

export const resolveCopyConflicts = async (
  conflicts: CopyConflict[],
  promptStore: PromptStoreLike,
): Promise<CopyConflictResolution> => {
  const overwritePaths = new Set<string>();
  const skipPaths = new Set<string>();
  let applyOverwriteAll = false;
  let applySkipAll = false;

  for (let index = 0; index < conflicts.length; index += 1) {
    const conflict = conflicts[index];
    if (!conflict) continue;
    const destinationKey = normalizePath(conflict.destinationPath);

    if (overwritePaths.has(destinationKey) || skipPaths.has(destinationKey)) {
      continue;
    }
    if (applyOverwriteAll) {
      overwritePaths.add(destinationKey);
      continue;
    }
    if (applySkipAll) {
      skipPaths.add(destinationKey);
      continue;
    }

    const decision = await promptCopyConflictDecision(
      promptStore,
      conflict,
      conflicts.length - index,
    );
    if (decision === "cancel") {
      return {
        cancelled: true,
        overwritePaths: [],
        skipPaths: [],
      };
    }
    if (decision === "overwrite") {
      overwritePaths.add(destinationKey);
      continue;
    }
    if (decision === "overwrite-all") {
      applyOverwriteAll = true;
      overwritePaths.add(destinationKey);
      continue;
    }
    if (decision === "skip") {
      skipPaths.add(destinationKey);
      continue;
    }
    if (decision === "skip-all") {
      applySkipAll = true;
      skipPaths.add(destinationKey);
    }
  }

  return {
    cancelled: false,
    overwritePaths: [...overwritePaths],
    skipPaths: [...skipPaths],
  };
};
