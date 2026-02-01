// Filesystem-related helpers shared across the app.
import type { EntryMeta } from "@/types";
import { normalizePath } from "./paths";

// Normalize a path down to its volume root (drive letter or UNC share).
export const getDriveKey = (path: string) => {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\");
    if (parts.length < 2) return null;
    return `\\\\${parts[0]}\\${parts[1]}`;
  }
  const driveMatch = /^[a-z]:/.exec(normalized);
  if (driveMatch) return driveMatch[0];
  if (normalized.startsWith("/")) return "/";
  return null;
};

export const entryExists = (meta: EntryMeta | null | undefined) => {
  return Boolean(meta && (meta.size != null || meta.modified != null));
};

export function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
    const cause = record.cause;
    if (typeof cause === "string" && cause.trim().length > 0) {
      return cause;
    }
    const nested = record.error;
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Ignore serialization errors.
    }
  }
  return fallback;
}
