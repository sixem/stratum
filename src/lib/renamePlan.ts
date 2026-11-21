// Keeps inline rename input and commit behavior aligned when extensions are hidden.
import { splitNameExtension } from "./fileName";

export const getRenameInputValue = (
  target: { name: string; isDir: boolean },
  hideExtension: boolean,
) => {
  if (!hideExtension || target.isDir) return target.name;
  return splitNameExtension(target.name).base;
};

export const applyHiddenExtension = (
  nextName: string,
  originalName: string,
  hideExtension: boolean,
  isDir: boolean,
) => {
  if (!hideExtension || isDir) return nextName;
  const { dotExtension } = splitNameExtension(originalName);
  if (!dotExtension) return nextName;
  const trimmed = nextName.trim();
  if (trimmed.toLowerCase().endsWith(dotExtension.toLowerCase())) {
    return trimmed;
  }
  return `${trimmed}${dotExtension}`;
};
