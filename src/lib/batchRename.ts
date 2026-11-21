// Compute batch rename previews without mutating entries or reading the filesystem.
import type { EntryContextTarget } from "@/types";
import { splitNameExtension } from "./fileName";
import { getParentPath, normalizePath } from "./paths";

export type BatchRenameRequest = { path: string; nextName: string };
export type BatchRenameMode = "number" | "replace" | "affix";

export type BatchRenameRule =
  | { mode: "number"; baseName: string }
  | { mode: "replace"; find: string; replacement: string; matchCase: boolean }
  | { mode: "affix"; prefix: string; suffix: string };

export const isBatchRenameRuleConfigured = (rule: BatchRenameRule) => {
  switch (rule.mode) {
    case "number": return Boolean(rule.baseName.trim());
    case "replace": return Boolean(rule.find);
    case "affix": return Boolean(rule.prefix || rule.suffix);
  }
};

export type BatchRenamePreviewRow = {
  item: EntryContextTarget;
  nextName: string;
  error?: string;
};

const reservedStem = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/i;
const invalidCharacter = /[\\/:*?"<>|\u0000-\u001f]/u;

const validateName = (name: string) => {
  if (!name.trim()) return "Enter a name.";
  if (name.length > 255) return "The name exceeds 255 characters.";
  if (invalidCharacter.test(name)) return "The name contains a character Windows disallows.";
  if (reservedStem.test(name.split(".", 1)[0].trimEnd())) return "Windows reserves this name.";
  if (/[. ]$/.test(name)) return "A name cannot end in a dot or space.";
};

const literalPattern = (input: string, matchCase: boolean) => {
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, matchCase ? "gu" : "giu");
};

export const buildBatchRenamePreview = (
  items: readonly EntryContextTarget[],
  rule: BatchRenameRule,
  preserveExtensions: boolean,
): BatchRenamePreviewRow[] => {
  const pattern = rule.mode === "replace" && rule.find
    ? literalPattern(rule.find, rule.matchCase)
    : null;
  const keys = (path: string, name: string) =>
    `${normalizePath(getParentPath(path) ?? "")}\\${name.toLowerCase()}`;
  const sources = new Map(items.map((item) => [keys(item.path, item.name), item.path]));
  const destinations = new Map<string, number>();

  const rows = items.map<BatchRenamePreviewRow>((item, index) => {
    const source = preserveExtensions && !item.isDir
      ? splitNameExtension(item.name)
      : { base: item.name, dotExtension: null };
    let nextName = item.name;
    switch (rule.mode) {
      case "number": {
        if (!rule.baseName.trim()) break;
        const suffix = index === 0 ? "" : ` (${index})`;
        const target = !preserveExtensions && !item.isDir
          ? splitNameExtension(rule.baseName)
          : { base: rule.baseName, dotExtension: source.dotExtension };
        nextName = target.base + suffix + (target.dotExtension ?? "");
        break;
      }
      case "replace":
        if (pattern) {
          nextName = source.base.replace(pattern, () => rule.replacement) + (source.dotExtension ?? "");
        }
        break;
      case "affix":
        nextName = rule.prefix + source.base + rule.suffix + (source.dotExtension ?? "");
        break;
    }

    const row = { item, nextName };
    if (nextName === item.name) return row;
    const error = validateName(nextName);
    if (error) return { ...row, error };
    const key = keys(item.path, nextName);
    destinations.set(key, (destinations.get(key) ?? 0) + 1);
    return row;
  });

  for (const row of rows) {
    if (row.error || row.nextName === row.item.name) continue;
    const key = keys(row.item.path, row.nextName);
    const occupant = sources.get(key);
    if ((destinations.get(key) ?? 0) > 1) {
      row.error = "Multiple items would get this name.";
    } else if (occupant && occupant !== row.item.path) {
      row.error = "Another selected item already has this name.";
    } else if (row.nextName.toLowerCase() === row.item.name.toLowerCase()) {
      row.error = "This batch cannot change only letter case.";
    }
  }
  return rows;
};
