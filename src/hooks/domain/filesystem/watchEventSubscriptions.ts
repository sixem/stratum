// Shared watcher event normalization + subscription helpers for useDirWatch.
// Keeping the native event shapes out of the hook makes the queueing flow
// easier to read and keeps both watcher events consistent.
import { listen } from "@tauri-apps/api/event";
import type { DirChangedEvent, DirRenameEvent } from "@/types";

export type QueuedWatchChange = {
  watchedPath: string;
  entryPaths: string[];
  renamePaths: string[];
};

type Normalizer<Payload> = (payload: Payload | null | undefined) => QueuedWatchChange | null;

type SubscribeToWatchEventOptions<Payload> = {
  eventName: string;
  normalizePayload: Normalizer<Payload>;
  onChange: (change: QueuedWatchChange) => void;
  onError: (error: unknown) => void;
};

const toTrimmedPath = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const collectEntryPaths = (paths: Array<string | null | undefined>) => {
  const nextPaths: string[] = [];
  paths.forEach((path) => {
    const trimmedPath = toTrimmedPath(path);
    if (trimmedPath) {
      nextPaths.push(trimmedPath);
    }
  });
  return nextPaths;
};

export const normalizeDirChangedEvent = (
  payload: DirChangedEvent | null | undefined,
): QueuedWatchChange | null => {
  const watchedPath = toTrimmedPath(payload?.path);
  if (!watchedPath) {
    return null;
  }

  return {
    watchedPath,
    entryPaths: collectEntryPaths(payload?.paths ?? []),
    renamePaths: [],
  };
};

export const normalizeDirRenameEvent = (
  payload: DirRenameEvent | null | undefined,
): QueuedWatchChange | null => {
  const watchedPath = toTrimmedPath(payload?.path);
  if (!watchedPath) {
    return null;
  }

  const entryPaths =
    payload?.paths && payload.paths.length > 0
      ? collectEntryPaths(payload.paths)
      : collectEntryPaths([payload?.from, payload?.to]);

  return {
    watchedPath,
    entryPaths,
    renamePaths: [watchedPath],
  };
};

export const subscribeToWatchEvent = <Payload>({
  eventName,
  normalizePayload,
  onChange,
  onError,
}: SubscribeToWatchEventOptions<Payload>) => {
  let active = true;
  let unlisten: (() => void) | null = null;

  void listen<Payload>(eventName, (event) => {
    const change = normalizePayload(event.payload);
    if (!change) {
      return;
    }
    onChange(change);
  })
    .then((stop) => {
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    })
    .catch((error) => {
      onError(error);
    });

  return () => {
    active = false;
    unlisten?.();
  };
};
