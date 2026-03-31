// Tracks "children changed" versions per directory so folder-derived UI can invalidate cleanly.
import { useSyncExternalStore } from "react";
import { normalizePath } from "@/lib";

type Listener = () => void;

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

export const getDirectoryChildVersion = (path: string) => {
  const key = normalizeDirectoryKey(path);
  if (!key) return 0;
  return versionsByPath.get(key) ?? 0;
};

export const bumpDirectoryChildVersion = (path: string) => {
  const key = normalizeDirectoryKey(path);
  if (!key) return;
  versionsByPath.set(key, (versionsByPath.get(key) ?? 0) + 1);
  emit();
};

export const bumpDirectoryChildVersions = (paths: Iterable<string>) => {
  let changed = false;
  for (const path of paths) {
    const key = normalizeDirectoryKey(path);
    if (!key) continue;
    versionsByPath.set(key, (versionsByPath.get(key) ?? 0) + 1);
    changed = true;
  }
  if (changed) {
    emit();
  }
};

export const useDirectoryChildStateRevision = () =>
  useSyncExternalStore(subscribe, () => revision, () => revision);
