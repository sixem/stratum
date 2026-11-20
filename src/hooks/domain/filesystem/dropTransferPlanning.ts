// Plans drag-and-drop transfers before the UI asks questions or starts backend work.
// Keeping this logic separate helps the hook stay focused on event wiring and hover state.
import { statEntries } from "@/api";
import {
  buildDropCandidate,
  entryExists,
  getDriveKey,
  joinPath,
  normalizeDropPath,
} from "@/lib";
import type { DropCandidate } from "@/lib";
import type { PromptConfig } from "@/modules";
import type { TransferMode } from "@/types";

type PromptStoreLike = {
  showPrompt: (prompt: PromptConfig) => void;
};

type MoveConflictDecision =
  | "overwrite"
  | "overwrite-all"
  | "skip"
  | "skip-all"
  | "cancel";

export type PlannedDropItem = {
  candidate: DropCandidate;
  name: string;
  destination: string;
  shouldMove: boolean;
};

export type DropTransferPlan = {
  mode: TransferMode;
  destination: string;
  destinationKey: string;
  items: PlannedDropItem[];
};

export type ResolvedDropTransferPlan = DropTransferPlan & {
  overwritePaths: string[];
  skippedByPrompt: number;
};

const buildCopyConflictPrompt = (
  promptStore: PromptStoreLike,
  destination: string,
  conflicts: PlannedDropItem[],
) => {
  const samples = conflicts.slice(0, 4).map((item) => item.name);
  const suffix =
    conflicts.length > samples.length
      ? `\n...and ${conflicts.length - samples.length} more`
      : "";
  const message = `Overwrite ${conflicts.length} item${
    conflicts.length === 1 ? "" : "s"
  } in ${destination}?\n\n${samples.join("\n")}${suffix}`;

  return new Promise<boolean>((resolve) => {
    promptStore.showPrompt({
      title: "Overwrite items?",
      content: message,
      confirmLabel: "Overwrite",
      cancelLabel: "Cancel",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
};

const promptMoveConflictDecision = (
  promptStore: PromptStoreLike,
  item: PlannedDropItem,
  destination: string,
  remaining: number,
) => {
  return new Promise<MoveConflictDecision>((resolve) => {
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
          label: "Overwrite all",
          onClick: () => resolve("overwrite-all"),
          variant: "ghost",
        },
        {
          label: "Skip all",
          onClick: () => resolve("skip-all"),
          variant: "ghost",
        },
      );
    }

    promptStore.showPrompt({
      title: "Item already exists",
      content: `A file or folder named "${item.name}" already exists in ${destination}.`,
      confirmLabel: "Overwrite",
      cancelLabel: "Cancel",
      actions,
      onConfirm: () => resolve("overwrite"),
      onCancel: () => resolve("cancel"),
    });
  });
};

const findConflictingItems = async (items: PlannedDropItem[]) => {
  const metas = await statEntries(items.map((item) => item.destination));
  return items.filter((_, index) => entryExists(metas[index]));
};

export const planDropTransfer = (
  paths: string[],
  targetPath: string,
  mode: TransferMode = "auto",
): DropTransferPlan | null => {
  const trimmed = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (trimmed.length === 0) return null;

  const destination = targetPath.trim();
  if (!destination) return null;

  const destinationKey = normalizeDropPath(destination);
  if (!destinationKey) return null;

  // Ignore drops that resolve to the same directory or folder itself.
  const candidates = trimmed
    .map((path) => buildDropCandidate(path, destinationKey))
    .filter((candidate): candidate is DropCandidate => Boolean(candidate));
  const meaningful = candidates.filter((candidate) => !candidate.isSameDirectory);
  if (meaningful.length === 0) return null;

  const destinationDriveKey = getDriveKey(destinationKey);
  const items = meaningful
    .map((candidate) => {
      const sourceDriveKey = getDriveKey(normalizeDropPath(candidate.path));
      const shouldMove = mode === "move" || (mode === "auto" &&
        destinationDriveKey != null &&
        sourceDriveKey != null &&
        destinationDriveKey.toLowerCase() === sourceDriveKey.toLowerCase());

      return {
        candidate,
        name: candidate.name,
        destination: joinPath(destination, candidate.name),
        shouldMove,
      };
    })
    .filter((item) => item.name && item.destination);

  if (items.length === 0) return null;

  return {
    mode,
    destination,
    destinationKey,
    items,
  };
};

export const resolveDropTransferConflicts = async (
  plan: DropTransferPlan,
  promptStore: PromptStoreLike,
): Promise<ResolvedDropTransferPlan | null> => {
  const conflicts = await findConflictingItems(plan.items);
  const copyConflicts = conflicts.filter((item) => !item.shouldMove);
  const moveConflicts = conflicts.filter((item) => item.shouldMove);

  const overwritePaths = new Set<string>();
  const skippedItems = new Set<PlannedDropItem>();
  let overwriteAllMoveConflicts = false;

  if (copyConflicts.length > 0) {
    const confirmed = await buildCopyConflictPrompt(
      promptStore,
      plan.destination,
      copyConflicts,
    );
    if (!confirmed) return null;
    copyConflicts.forEach((item) => overwritePaths.add(item.destination));
  }

  for (let index = 0; index < moveConflicts.length; index += 1) {
    const item = moveConflicts[index];
    if (!item) continue;
    if (overwriteAllMoveConflicts) {
      overwritePaths.add(item.destination);
      continue;
    }

    const decision = await promptMoveConflictDecision(
      promptStore,
      item,
      plan.destination,
      moveConflicts.length - index,
    );
    if (decision === "cancel") return null;
    if (decision === "overwrite") {
      overwritePaths.add(item.destination);
      continue;
    }
    if (decision === "overwrite-all") {
      overwriteAllMoveConflicts = true;
      overwritePaths.add(item.destination);
      continue;
    }
    if (decision === "skip") {
      skippedItems.add(item);
      continue;
    }
    if (decision === "skip-all") {
      for (let rest = index; rest < moveConflicts.length; rest += 1) {
        const conflict = moveConflicts[rest];
        if (!conflict) continue;
        skippedItems.add(conflict);
      }
      break;
    }
  }

  const items = plan.items.filter((item) => !skippedItems.has(item));
  if (items.length === 0) return null;

  return {
    mode: plan.mode,
    destination: plan.destination,
    destinationKey: plan.destinationKey,
    items,
    overwritePaths: [...overwritePaths],
    skippedByPrompt: plan.items.length - items.length,
  };
};
