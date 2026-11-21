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

type OpenWithLookup = {
  extension: string;
  status: "ready" | "error";
  handlers: OpenWithHandler[];
};

const OPEN_WITH_CACHE_TTL_MS = 5 * 60 * 1000;
const OPEN_WITH_CACHE_LIMIT = 128;
const EMPTY_HANDLERS: OpenWithHandler[] = [];

// Keep a session-local cache so repeated right-clicks stay instant.
const openWithCacheByExtension = new Map<string, OpenWithCacheEntry>();
const openWithPendingByExtension = new Map<string, Promise<OpenWithHandler[]>>();

const readCachedHandlers = (cacheKey: string): OpenWithHandler[] | null => {
  const cached = openWithCacheByExtension.get(cacheKey);
  if (!cached) return null;
  openWithCacheByExtension.delete(cacheKey);
  if (cached.expiresAt <= Date.now()) return null;
  openWithCacheByExtension.set(cacheKey, cached);
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
      if (openWithCacheByExtension.size > OPEN_WITH_CACHE_LIMIT) {
        const oldest = openWithCacheByExtension.keys().next().value;
        if (oldest !== undefined) openWithCacheByExtension.delete(oldest);
      }
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
  const [lookup, setLookup] = useState<OpenWithLookup | null>(null);
  const fileTarget = target && !target.isDir ? target : null;
  const extension = fileTarget ? getExtension(fileTarget.name) : null;
  const targetPath = fileTarget?.path ?? null;

  useEffect(() => {
    if (!targetPath || !extension) {
      setLookup(null);
      return;
    }

    const cached = readCachedHandlers(extension);
    if (cached) {
      setLookup({ extension, status: "ready", handlers: cached });
      return;
    }

    let active = true;
    setLookup(null);
    void requestHandlers(extension, targetPath)
      .then((handlers) => {
        if (active) setLookup({ extension, status: "ready", handlers });
      })
      .catch(() => {
        if (active) setLookup({ extension, status: "error", handlers: EMPTY_HANDLERS });
      });

    return () => {
      active = false;
    };
  }, [extension, targetPath]);

  // A new menu can render before the previous lookup's effect is cleaned up.
  const current = lookup?.extension === extension ? lookup : null;
  const status = !targetPath ? "idle" : !extension ? "ready" : current?.status ?? "loading";
  const handlers = current?.handlers ?? EMPTY_HANDLERS;
  return useMemo(() => ({ status, handlers, targetPath }), [status, handlers, targetPath]);
};
