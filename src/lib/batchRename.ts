// Compute batch rename previews without mutating entries or reading the filesystem.
import type { EntryContextTarget } from "@/types";
import { splitNameExtension } from "./fileName.ts";
import { getParentPath, normalizePath } from "./paths.ts";
import { remoteParent } from "./remotePaths.ts";

export type BatchRenameRequest = { path: string; nextName: string };
export type BatchRenameMode = "number" | "replace" | "affix";

export const BATCH_RENAME_NUMBER_STYLES = ["parentheses", "space", "dash", "underscore"] as const;
export const BATCH_RENAME_OCCURRENCES = ["all", "first", "last"] as const;

export type BatchRenameNumbering = {
  start: number;
  step: number;
  digits: number;
  position: "before" | "after";
  style: typeof BATCH_RENAME_NUMBER_STYLES[number];
  numberFirst: boolean;
};

export const DEFAULT_BATCH_RENAME_NUMBERING: Readonly<BatchRenameNumbering> = {
  start: 1,
  step: 1,
  digits: 1,
  position: "after",
  style: "parentheses",
  numberFirst: false,
};

export const BATCH_RENAME_MAX_DIGITS = 12;

export type BatchRenameRule =
  | { mode: "number"; baseName: string; numbering?: BatchRenameNumbering }
  | {
    mode: "replace";
    find: string;
    replacement: string;
    matchCase: boolean;
    occurrence?: typeof BATCH_RENAME_OCCURRENCES[number];
  }
  | { mode: "affix"; prefix: string; suffix: string };

export const isBatchRenameNumberingValid = ({ start, step, digits }: BatchRenameNumbering) =>
  Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(step) && step >= 1 &&
  Number.isInteger(digits) && digits >= 1 && digits <= BATCH_RENAME_MAX_DIGITS;

export const isBatchRenameRuleConfigured = (rule: BatchRenameRule) => {
  switch (rule.mode) {
    case "number": return Boolean(rule.baseName.trim()) &&
      isBatchRenameNumberingValid(rule.numbering ?? DEFAULT_BATCH_RENAME_NUMBERING);
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

const validateName = (name: string, remote: boolean) => {
  if (remote) {
    if (!name || name === "." || name === "..") return "Enter a name.";
    if (name.includes("/") || name.includes("\0")) return "A remote name cannot contain a slash or NUL.";
    return;
  }
  if (!name.trim()) return "Enter a name.";
  if (name.length > 255) return "The name exceeds 255 characters.";
  if (invalidCharacter.test(name)) return "The name contains a character Windows disallows.";
  if (reservedStem.test(name.split(".", 1)[0].trimEnd())) return "Windows reserves this name.";
  if (/[. ]$/.test(name)) return "A name cannot end in a dot or space.";
};

const literalPattern = (input: string, matchCase: boolean, firstOnly: boolean) => {
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, `u${matchCase ? "" : "i"}${firstOnly ? "" : "g"}`);
};

const replaceMatch = (base: string, pattern: RegExp, rule: Extract<BatchRenameRule, { mode: "replace" }>) => {
  if (rule.occurrence !== "last") return base.replace(pattern, () => rule.replacement);
  let last: RegExpMatchArray | undefined;
  for (const match of base.matchAll(pattern)) last = match;
  if (last?.index === undefined) return base;
  return base.slice(0, last.index) + rule.replacement + base.slice(last.index + last[0].length);
};

const numberName = (base: string, number: number, numbering: BatchRenameNumbering) => {
  const digits = String(number).padStart(numbering.digits, "0");
  const before = numbering.position === "before";
  if (numbering.style === "parentheses") return before ? `(${digits}) ${base}` : `${base} (${digits})`;
  const separator = numbering.style === "dash" ? "-" : numbering.style === "underscore" ? "_" : " ";
  return before ? `${digits}${separator}${base}` : `${base}${separator}${digits}`;
};

type PreparedBatchRenameItem = {
  item: EntryContextTarget;
  parentPrefix: string;
  nameKey: string;
  stem: string;
  dotExtension: string;
};

type BatchRenameSelection = {
  entries: readonly PreparedBatchRenameItem[];
  sourcePaths: ReadonlyMap<string, string>;
  remote: boolean;
};

// Prepare the dialog's selection once so editing a rule only evaluates new names.
export const prepareBatchRenameSelection = (items: readonly EntryContextTarget[], remote = false): BatchRenameSelection => {
  const sourcePaths = new Map<string, string>();
  const entries = items.map((item) => {
    const parentPrefix = remote ? `${remoteParent(item.path)}/` : `${normalizePath(getParentPath(item.path) ?? "")}\\`;
    const nameKey = remote ? item.name : item.name.toLowerCase();
    const parts = item.isDir ? null : splitNameExtension(item.name);
    sourcePaths.set(parentPrefix + nameKey, item.path);
    return { item, parentPrefix, nameKey, stem: parts?.base ?? item.name, dotExtension: parts?.dotExtension ?? "" };
  });
  return { entries, sourcePaths, remote };
};

export const buildBatchRenamePreview = (
  { entries, sourcePaths, remote }: BatchRenameSelection,
  rule: BatchRenameRule,
  preserveExtensions: boolean,
): BatchRenamePreviewRow[] => {
  const pattern = rule.mode === "replace" && rule.find
    ? literalPattern(rule.find, rule.matchCase, rule.occurrence === "first")
    : null;
  const numbering = rule.mode === "number" ? rule.numbering ?? DEFAULT_BATCH_RENAME_NUMBERING : null;
  if (numbering && !isBatchRenameNumberingValid(numbering)) {
    return entries.map(({ item }) => ({ item, nextName: item.name }));
  }
  const baseName = rule.mode === "number" && rule.baseName.trim() ? rule.baseName : null;
  const numberedFile = baseName && !preserveExtensions ? splitNameExtension(baseName) : null;
  const destinations = new Map<string, BatchRenamePreviewRow>();

  return entries.map<BatchRenamePreviewRow>(({ item, parentPrefix, nameKey, stem, dotExtension }, index) => {
    const sourceName = preserveExtensions ? stem : item.name;
    const preservedExtension = preserveExtensions ? dotExtension : "";
    let nextName = item.name;
    switch (rule.mode) {
      case "number": {
        if (!baseName || !numbering) break;
        const fileName = item.isDir ? null : numberedFile;
        const targetBase = fileName?.base ?? baseName;
        const targetExtension = fileName?.dotExtension ?? preservedExtension;
        const offset = numbering.numberFirst ? index : index - 1;
        const number = numbering.start + offset * numbering.step;
        if (offset >= 0 && !Number.isSafeInteger(number)) {
          return { item, nextName: item.name, error: "The sequence exceeds the supported number range." };
        }
        const base = offset < 0 ? targetBase : numberName(targetBase, number, numbering);
        nextName = base + targetExtension;
        break;
      }
      case "replace":
        if (pattern) {
          nextName = replaceMatch(sourceName, pattern, rule) + preservedExtension;
        }
        break;
      case "affix":
        nextName = rule.prefix + sourceName + rule.suffix + preservedExtension;
        break;
    }

    const row: BatchRenamePreviewRow = { item, nextName };
    if (nextName === item.name) return row;
    const error = validateName(nextName, remote);
    if (error) return { ...row, error };
    const nextNameKey = remote ? nextName : nextName.toLowerCase();
    const key = parentPrefix + nextNameKey;
    const previous = destinations.get(key);
    if (previous) {
      row.error = "Multiple items would get this name.";
      // A shared destination takes precedence over a case-only rename or source collision.
      previous.error = row.error;
      return row;
    }
    destinations.set(key, row);
    const occupant = sourcePaths.get(key);
    if (occupant && occupant !== item.path) {
      row.error = "Another selected item already has this name.";
    } else if (nextNameKey === nameKey) {
      row.error = "This batch cannot change only letter case.";
    }
    return row;
  });
};
