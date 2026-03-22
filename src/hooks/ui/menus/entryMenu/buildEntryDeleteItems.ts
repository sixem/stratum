// Builds delete actions, including the optional confirmation prompt.

import { tabLabel } from "@/lib";
import type { PromptConfig } from "@/modules";
import type { ContextMenuItem } from "@/types";

type BuildEntryDeleteItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
  confirmDelete: boolean;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  showPrompt: (prompt: PromptConfig) => void;
};

export const buildEntryDeleteItems = ({
  actionTargets,
  hasTargets,
  confirmDelete,
  onDeleteEntries,
  showPrompt,
}: BuildEntryDeleteItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-delete",
    label: "Delete",
    icon: "delete",
    onSelect: () => {
      if (!hasTargets) return;

      const count = actionTargets.length;
      const label = count === 1 ? tabLabel(actionTargets[0] ?? "") : `${count} items`;
      const runDelete = () => {
        void onDeleteEntries(actionTargets);
      };

      if (!confirmDelete) {
        runDelete();
        return;
      }

      showPrompt({
        title: count === 1 ? "Delete item?" : "Delete items?",
        content: `Delete ${label}? You can undo with Ctrl+Z.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        onConfirm: runDelete,
      });
    },
    disabled: !hasTargets,
  },
];
