// Selection helpers shared by view, keybind, and rename flows.
import { tabLabel } from "./paths";

export const getSelectionTargets = (selected: Set<string>, parentPath: string | null) => {
  return Array.from(selected).filter((path) => path !== parentPath);
};

export const formatDeleteLabel = (targets: string[]) => {
  const count = targets.length;
  if (count === 1) return tabLabel(targets[0] ?? "");
  return `${count} items`;
};
