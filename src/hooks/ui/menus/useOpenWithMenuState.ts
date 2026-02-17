// Resolves and caches "Open with" handlers per extension for context menus.
import { useEffect, useMemo, useState } from "react";
import { listOpenWithHandlers } from "@/api";
import { getExtension } from "@/lib";
import type { EntryContextTarget, OpenWithHandler } from "@/types";

type OpenWithMenuStatus = "idle" | "loading" | "ready" | "error";

type OpenWithMenuState = {
  status: OpenWithMenuStatus;
  handlers: OpenWithHandler[];
  targetPath: string | null;
};

type OpenWithCacheEntry = {
  expiresAt: number;
  handlers: OpenWithHandler[];
};

const OPEN_WITH_CACHE_TTL_MS = 5 * 60 * 1000;
const OPEN_WITH_NO_EXTENSION_KEY = "<none>";

// Keep a session-local cache so repeated right-clicks stay instant.
const openWithCacheByExtension = new Map<string, OpenWithCacheEntry>();
const openWithPendingByExtension = new Map<string, Promise<OpenWithHandler[]>>();

const toCacheKey = (target: EntryContextTarget): string => {
  const extension = getExtension(target.name);
  return extension ?? OPEN_WITH_NO_EXTENSION_KEY;
};

const readCachedHandlers = (cacheKey: string): OpenWithHandler[] | null => {
  const cached = openWithCacheByExtension.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    openWithCacheByExtension.delete(cacheKey);
    return null;
  }
  return cached.handlers;
};

const requestHandlers = (cacheKey: string, path: string): Promise<OpenWithHandler[]> => {
  const active = openWithPendingByExtension.get(cacheKey);
  if (active) return active;

  const request = listOpenWithHandlers(path)
    .then((handlers) => {
      openWithCacheByExtension.set(cacheKey, {
        expiresAt: Date.now() + OPEN_WITH_CACHE_TTL_MS,
        handlers,
      });
      return handlers;
    })
    .finally(() => {
      openWithPendingByExtension.delete(cacheKey);
    });

  openWithPendingByExtension.set(cacheKey, request);
  return request;
};

export const useOpenWithMenuState = (
  target: EntryContextTarget | null,
): OpenWithMenuState => {
  const [status, setStatus] = useState<OpenWithMenuStatus>("idle");
  const [handlers, setHandlers] = useState<OpenWithHandler[]>([]);

  const fileTarget = useMemo(() => {
    if (!target || target.isDir) return null;
    return target;
  }, [target]);
  const cacheKey = useMemo(
    () => (fileTarget ? toCacheKey(fileTarget) : null),
    [fileTarget],
  );
  const targetPath = fileTarget?.path ?? null;

  useEffect(() => {
    if (!fileTarget || !cacheKey) {
      setStatus("idle");
      setHandlers([]);
      return;
    }
    if (cacheKey === OPEN_WITH_NO_EXTENSION_KEY) {
      setStatus("ready");
      setHandlers([]);
      return;
    }

    const cached = readCachedHandlers(cacheKey);
    if (cached) {
      setStatus("ready");
      setHandlers(cached);
      return;
    }

    let active = true;
    setStatus("loading");
    setHandlers([]);
    void requestHandlers(cacheKey, fileTarget.path)
      .then((nextHandlers) => {
        if (!active) return;
        setStatus("ready");
        setHandlers(nextHandlers);
      })
      .catch(() => {
        if (!active) return;
        setStatus("error");
        setHandlers([]);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, fileTarget]);

  return {
    status,
    handlers,
    targetPath,
  };
};
