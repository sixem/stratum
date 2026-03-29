// Plans drag-and-drop transfers before the UI asks questions or starts backend work.
// Keeping this logic separate helps the hook stay focused on event wiring and hover state.
import { statEntries } from "@/api";
import {
  buildDropCandidate,
  getDriveKey,
  joinPath,
  normalizeDropPath,
  normalizePath,
} from "@/lib";
import type { DropCandidate } from "@/lib";
import type { PromptConfig } from "@/modules";

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
  pathKey: string;
  name: string;
  destination: string;
  shouldMove: boolean;
};

export type DropTransferPlan = {
  destination: string;
  destinationKey: string;
  items: PlannedDropItem[];
};

export type ResolvedDropTransferPlan = {
  destination: string;
  destinationKey: string;
  items: PlannedDropItem[];
  overwrite: boolean;
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

const findConflictingItemKeys = async (items: PlannedDropItem[]) => {
  if (items.length === 0) {
    return new Set<string>();
  }

  const metas = await statEntries(items.map((item) => item.destination));
  const conflictingKeys = new Set<string>();

  metas.forEach((meta, index) => {
    const exists = meta.size != null || meta.modified != null;
    if (!exists) return;
    const item = items[index];
    if (!item) return;
    conflictingKeys.add(item.pathKey);
  });

  return conflictingKeys;
};

export const planDropTransfer = (
  paths: string[],
  targetPath: string | null,
  fallbackPath: string,
): DropTransferPlan | null => {
  const trimmed = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (trimmed.length === 0) return null;

  const destination = (targetPath ?? fallbackPath).trim();
  if (!destination) return null;

  const destinationKey = normalizeDropPath(destination);
  if (!destinationKey) return null;

  // Ignore drops that resolve to the same directory or folder itself.
  const candidates = trimmed
    .map((path) => buildDropCandidate(path, destinationKey))
    .filter((candidate): candidate is DropCandidate => Boolean(candidate));
  const meaningful = candidates.filter((candidate) => !candidate.isSameDirectory);
  if (meaningful.length === 0) return null;

  const destinationDriveKey = getDriveKey(destination);
  const items = meaningful
    .map((candidate) => {
      const sourceDriveKey = getDriveKey(candidate.path);
      const shouldMove =
        destinationDriveKey != null &&
        sourceDriveKey != null &&
        destinationDriveKey.toLowerCase() === sourceDriveKey.toLowerCase();

      return {
        candidate,
        pathKey: normalizePath(candidate.path),
        name: candidate.name,
        destination: joinPath(destination, candidate.name),
        shouldMove,
      };
    })
    .filter((item) => item.name && item.destination);

  if (items.length === 0) return null;

  return {
    destination,
    destinationKey,
    items,
  };
};

export const resolveDropTransferConflicts = async (
  plan: DropTransferPlan,
  promptStore: PromptStoreLike,
): Promise<ResolvedDropTransferPlan | null> => {
  const conflictingKeys = await findConflictingItemKeys(plan.items);
  const copyConflicts = plan.items.filter(
    (item) => !item.shouldMove && conflictingKeys.has(item.pathKey),
  );
  const moveConflicts = plan.items.filter(
    (item) => item.shouldMove && conflictingKeys.has(item.pathKey),
  );

  const overwriteKeys = new Set<string>();
  const skippedKeys = new Set<string>();
  let overwriteAllMoveConflicts = false;

  if (copyConflicts.length > 0) {
    const confirmed = await buildCopyConflictPrompt(
      promptStore,
      plan.destination,
      copyConflicts,
    );
    if (!confirmed) return null;
    copyConflicts.forEach((item) => overwriteKeys.add(item.pathKey));
  }

  for (let index = 0; index < moveConflicts.length; index += 1) {
    const item = moveConflicts[index];
    if (!item) continue;
    if (skippedKeys.has(item.pathKey)) continue;
    if (overwriteAllMoveConflicts) {
      overwriteKeys.add(item.pathKey);
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
      overwriteKeys.add(item.pathKey);
      continue;
    }
    if (decision === "overwrite-all") {
      overwriteAllMoveConflicts = true;
      overwriteKeys.add(item.pathKey);
      continue;
    }
    if (decision === "skip") {
      skippedKeys.add(item.pathKey);
      continue;
    }
    if (decision === "skip-all") {
      for (let rest = index; rest < moveConflicts.length; rest += 1) {
        const conflict = moveConflicts[rest];
        if (!conflict) continue;
        skippedKeys.add(conflict.pathKey);
      }
      break;
    }
  }

  const items = plan.items.filter((item) => !skippedKeys.has(item.pathKey));
  if (items.length === 0) return null;

  return {
    destination: plan.destination,
    destinationKey: plan.destinationKey,
    items,
    overwrite: items.some((item) => overwriteKeys.has(item.pathKey)),
    skippedByPrompt: plan.items.length - items.length,
  };
};
