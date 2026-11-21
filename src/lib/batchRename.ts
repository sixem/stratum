// Compute batch rename previews without mutating entries or reading the filesystem.
import type { EntryContextTarget } from "@/types";
import { splitNameExtension } from "./fileName";
import { getParentPath, normalizePath } from "./paths";

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

const validateName = (name: string) => {
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

export const buildBatchRenamePreview = (
  items: readonly EntryContextTarget[],
  rule: BatchRenameRule,
  preserveExtensions: boolean,
): BatchRenamePreviewRow[] => {
  const pattern = rule.mode === "replace" && rule.find
    ? literalPattern(rule.find, rule.matchCase, rule.occurrence === "first")
    : null;
  const numbering = rule.mode === "number" ? rule.numbering ?? DEFAULT_BATCH_RENAME_NUMBERING : null;
  if (numbering && !isBatchRenameNumberingValid(numbering)) {
    return items.map((item) => ({ item, nextName: item.name }));
  }
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
        if (!rule.baseName.trim() || !numbering) break;
        const target = !preserveExtensions && !item.isDir
          ? splitNameExtension(rule.baseName)
          : { base: rule.baseName, dotExtension: source.dotExtension };
        const offset = numbering.numberFirst ? index : index - 1;
        const number = numbering.start + offset * numbering.step;
        if (offset >= 0 && !Number.isSafeInteger(number)) {
          return { item, nextName: item.name, error: "The sequence exceeds the supported number range." };
        }
        const base = offset < 0 ? target.base : numberName(target.base, number, numbering);
        nextName = base + (target.dotExtension ?? "");
        break;
      }
      case "replace":
        if (pattern) {
          nextName = replaceMatch(source.base, pattern, rule) + (source.dotExtension ?? "");
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
