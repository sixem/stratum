import { createWithEqualityFn } from "zustand/traditional";
import { isBatchRenameRuleConfigured, type BatchRenameRule } from "@/lib/batchRename";

export type BatchRenamePreset = {
  id: string;
  name: string;
  rule: BatchRenameRule;
  preserveExtensions: boolean;
};

type BatchRenamePresetStore = {
  presets: BatchRenamePreset[];
  save: (
    draft: Omit<BatchRenamePreset, "id">,
    existingId?: string,
  ) => { preset: BatchRenamePreset } | { error: string };
  remove: (id: string) => { ok: true } | { error: string };
};

const STORAGE_KEY = "stratum.batch-rename-presets";
const STORAGE_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRule = (value: unknown): BatchRenameRule | undefined => {
  if (!isRecord(value)) return;

  switch (value.mode) {
    case "number": {
      const { baseName } = value;
      if (typeof baseName === "string") return { mode: "number", baseName };
      break;
    }
    case "replace": {
      const { find, replacement, matchCase } = value;
      if (typeof find === "string" && typeof replacement === "string" && typeof matchCase === "boolean") {
        return { mode: "replace", find, replacement, matchCase };
      }
      break;
    }
    case "affix": {
      const { prefix, suffix } = value;
      if (typeof prefix === "string" && typeof suffix === "string") {
        return { mode: "affix", prefix, suffix };
      }
      break;
    }
  }
};

const readStoredPresets = (): BatchRenamePreset[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const payload: unknown = JSON.parse(raw);
    if (!isRecord(payload) || payload.version !== STORAGE_VERSION || !Array.isArray(payload.presets)) return [];

    const presets: BatchRenamePreset[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const entry of payload.presets) {
      if (!isRecord(entry)) continue;
      const { id, name, preserveExtensions } = entry;
      if (typeof id !== "string" || !id.trim() || typeof name !== "string" || typeof preserveExtensions !== "boolean") continue;
      const trimmedName = name.trim();
      const key = trimmedName.toLowerCase();
      if (!key || ids.has(id) || names.has(key)) continue;
      const rule = readRule(entry.rule);
      if (!rule || !isBatchRenameRuleConfigured(rule)) continue;

      presets.push({ id, name: trimmedName, rule, preserveExtensions });
      ids.add(id);
      names.add(key);
    }
    return presets;
  } catch {
    return [];
  }
};

const writeStoredPresets = (presets: BatchRenamePreset[]) => {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, presets }));
    return true;
  } catch {
    return false;
  }
};

export const useBatchRenamePresetStore = createWithEqualityFn<BatchRenamePresetStore>((set, get) => ({
  presets: readStoredPresets(),
  save: (draft, existingId) => {
    const presets = get().presets;
    const name = draft.name.trim();
    if (!name) return { error: "Enter a preset name." };
    if (existingId !== undefined && !presets.some(({ id }) => id === existingId)) {
      return { error: "This preset no longer exists." };
    }
    const key = name.toLowerCase();
    if (presets.some((preset) => preset.id !== existingId && preset.name.toLowerCase() === key)) {
      return { error: "A preset with this name already exists." };
    }
    const rule = readRule(draft.rule);
    if (!rule || !isBatchRenameRuleConfigured(rule)) {
      return { error: "Enter a rename rule before saving the preset." };
    }

    const id = existingId ?? globalThis.crypto.randomUUID();
    const preset = { id, name, rule, preserveExtensions: draft.preserveExtensions };
    const next = existingId === undefined
      ? [...presets, preset]
      : presets.map((previous) => previous.id === existingId ? preset : previous);
    if (!writeStoredPresets(next)) return { error: "Could not save the rename preset." };
    set({ presets: next });
    return { preset };
  },
  remove: (id) => {
    const presets = get().presets;
    const next = presets.filter((preset) => preset.id !== id);
    if (next.length === presets.length) return { error: "This preset no longer exists." };
    if (!writeStoredPresets(next)) return { error: "Could not remove the rename preset." };
    set({ presets: next });
    return { ok: true };
  },
}));
