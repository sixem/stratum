// Keybind definitions and helpers for configurable shortcuts.
import {
  DEFAULT_KEYBINDS,
  KEYBIND_DEFINITIONS,
  MODIFIER_KEYS,
  MODIFIER_ORDER,
  PRIMARY_MODIFIERS,
  RESERVED_KEYBIND_DEFINITIONS,
  RESERVED_KEYBINDS,
  SINGLE_CHAR_PATTERN,
} from "@/constants";
import type { KeybindAction, KeybindDefinition, KeybindMap } from "@/constants";

export type { KeybindAction, KeybindDefinition, KeybindMap };
export { DEFAULT_KEYBINDS, KEYBIND_DEFINITIONS, RESERVED_KEYBINDS };

const normalizeKeyToken = (token: string) => {
  const trimmed = token.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "shift") return "Shift";
  if (["meta", "cmd", "command", "win", "super"].includes(lower)) return "Meta";
  if (["arrowleft", "left"].includes(lower)) return "ArrowLeft";
  if (["arrowright", "right"].includes(lower)) return "ArrowRight";
  if (["arrowup", "up"].includes(lower)) return "ArrowUp";
  if (["arrowdown", "down"].includes(lower)) return "ArrowDown";
  if (lower === "escape" || lower === "esc") return "Escape";
  if (lower === "delete" || lower === "del") return "Delete";
  if (lower === " ") return "Space";
  if (/^f\d+$/i.test(lower)) return lower.toUpperCase();
  if (trimmed.length === 1) return trimmed.toLowerCase();
  return trimmed;
};

const formatToken = (token: string) => {
  switch (token) {
    case "Control":
      return "Ctrl";
    case "Alt":
      return "Alt";
    case "Shift":
      return "Shift";
    case "Meta":
      return "Win";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "Escape":
      return "Esc";
    case "Delete":
      return "Delete";
    case "Space":
      return "Space";
    default:
      return token.length === 1 ? token.toUpperCase() : token;
  }
};

export const normalizeKeybind = (binding: string) => {
  const tokens = binding
    .split("+")
    .map((token) => normalizeKeyToken(token))
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const mods: string[] = [];
  let key: string | null = null;
  tokens.forEach((token) => {
    if (MODIFIER_KEYS.has(token as (typeof MODIFIER_ORDER)[number])) {
      if (!mods.includes(token)) {
        mods.push(token);
      }
      return;
    }
    key = token;
  });

  if (!key) return "";
  const orderedMods = MODIFIER_ORDER.filter((mod) => mods.includes(mod));
  return [...orderedMods, key].join("+");
};

const isSingleCharacterBinding = (normalized: string) => {
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  if (!key || !SINGLE_CHAR_PATTERN.test(key)) return false;
  const modifiers = parts.slice(0, -1);
  return !modifiers.some((mod) => PRIMARY_MODIFIERS.has(mod));
};

// Single-character shortcuts must include Ctrl/Alt/Win to avoid interfering with typeahead.
export const isBareCharacterKeybind = (binding: string) => {
  const normalized = normalizeKeybind(binding);
  return isSingleCharacterBinding(normalized);
};

export const formatKeybind = (binding: string) => {
  const normalized = normalizeKeybind(binding);
  if (!normalized) return "";
  return normalized
    .split("+")
    .map((token) => formatToken(token))
    .join("+");
};

export const getReservedKeybindLabel = (binding: string) => {
  const normalized = normalizeKeybind(binding);
  if (!normalized) return null;
  const reserved = RESERVED_KEYBIND_DEFINITIONS.find(
    (definition) => normalizeKeybind(definition.combo) === normalized,
  );
  return reserved?.label ?? null;
};

export const isReservedKeybind = (binding: string) => {
  return Boolean(getReservedKeybindLabel(binding));
};

export const buildKeybindFromEvent = (event: KeyboardEvent) => {
  const keyToken = normalizeKeyToken(event.key);
  if (!keyToken) return null;
  if (MODIFIER_KEYS.has(keyToken as (typeof MODIFIER_ORDER)[number])) {
    return null;
  }
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  const combined = [...modifiers, keyToken].join("+");
  return normalizeKeybind(combined);
};

const sanitizeKeybinds = (bindings: KeybindMap) => {
  const used = new Set<string>();
  const reserved = new Set(RESERVED_KEYBINDS.map((bind) => normalizeKeybind(bind)));
  const next: KeybindMap = { ...DEFAULT_KEYBINDS };

  const isAllowed = (normalized: string) => {
    if (!normalized) return false;
    if (reserved.has(normalized)) return false;
    if (isSingleCharacterBinding(normalized)) return false;
    if (used.has(normalized)) return false;
    return true;
  };

  KEYBIND_DEFINITIONS.forEach((definition) => {
    const candidate = normalizeKeybind(bindings[definition.id] ?? "");
    const fallback = normalizeKeybind(definition.default);
    if (isAllowed(candidate)) {
      next[definition.id] = candidate;
      used.add(candidate);
      return;
    }
    if (isAllowed(fallback)) {
      next[definition.id] = fallback;
      used.add(fallback);
      return;
    }
    next[definition.id] = "";
  });

  return next;
};

export const coerceKeybinds = (value: unknown) => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const merged: KeybindMap = { ...DEFAULT_KEYBINDS };
  if (record) {
    KEYBIND_DEFINITIONS.forEach((definition) => {
      const candidate = record[definition.id];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        merged[definition.id] = candidate.trim();
      }
    });
  }
  return sanitizeKeybinds(merged);
};
