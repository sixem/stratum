// Tracks "children changed" versions per directory so folder-derived UI can invalidate cleanly.
import { useSyncExternalStore } from "react";
import { normalizePath } from "@/lib";

type Listener = () => void;

// Keep the directory-version table bounded so long sessions do not retain
// every path the user has ever touched.
const DIRECTORY_CHILD_VERSION_LIMIT = 4096;

const versionsByPath = new Map<string, number>();
const listeners = new Set<Listener>();
let revision = 0;

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const emit = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};

const normalizeDirectoryKey = (path: string) => normalizePath(path.trim());

const upsertDirectoryChildVersion = (key: string, version: number) => {
  // Refresh insertion order so pruning behaves like a simple LRU.
  if (versionsByPath.has(key)) {
    versionsByPath.delete(key);
  }
  versionsByPath.set(key, version);
  while (versionsByPath.size > DIRECTORY_CHILD_VERSION_LIMIT) {
    const oldestKey = versionsByPath.keys().next().value as string | undefined;
    if (!oldestKey) break;
    versionsByPath.delete(oldestKey);
  }
};

export const getDirectoryChildVersion = (path: string) => {
  const key = normalizeDirectoryKey(path);
  if (!key) return 0;
  return versionsByPath.get(key) ?? 0;
};

export const bumpDirectoryChildVersion = (path: string) => {
  const key = normalizeDirectoryKey(path);
  if (!key) return;
  upsertDirectoryChildVersion(key, (versionsByPath.get(key) ?? 0) + 1);
  emit();
};

export const bumpDirectoryChildVersions = (paths: Iterable<string>) => {
  let changed = false;
  for (const path of paths) {
    const key = normalizeDirectoryKey(path);
    if (!key) continue;
    upsertDirectoryChildVersion(key, (versionsByPath.get(key) ?? 0) + 1);
    changed = true;
  }
  if (changed) {
    emit();
  }
};

export const useDirectoryChildStateRevision = () =>
  useSyncExternalStore(subscribe, () => revision, () => revision);
