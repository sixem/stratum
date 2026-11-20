import { useCallback, useEffect, useRef } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowSizePayload = {
  width: number;
  height: number;
};

type StoredWindowState = {
  version: number;
  size: WindowSizePayload;
};

const STORAGE_KEY = "stratum.window";
const STORAGE_VERSION = 1;
const PERSIST_DELAY_MS = 240;
const MIN_SIZE = 320;
const MAX_SIZE = 8192;

const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const clampSize = (value: number) => {
  if (!Number.isFinite(value)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
};

const readViewportSize = (): WindowSizePayload | null => {
  if (typeof window === "undefined") return null;
  return {
    width: clampSize(window.innerWidth),
    height: clampSize(window.innerHeight),
  };
};

const readStoredSize = (): WindowSizePayload | null => {
  try {
    if (!("localStorage" in globalThis)) return null;
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWindowState | WindowSizePayload;
    if ("size" in parsed) {
      const size = parsed.size;
      return {
        width: clampSize(size.width),
        height: clampSize(size.height),
      };
    }
    return {
      width: clampSize(parsed.width),
      height: clampSize(parsed.height),
    };
  } catch {
    return null;
  }
};

const writeStoredSize = (size: WindowSizePayload) => {
  try {
    if (!("localStorage" in globalThis)) return;
    const payload: StoredWindowState = {
      version: STORAGE_VERSION,
      size,
    };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
};

export const useWindowSize = () => {
  const persistTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<WindowSizePayload | null>(null);
  // Expose a close-safe flush so other hooks can persist size on demand.
  const flushPersist = useCallback(() => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const latest = lastSizeRef.current ?? readViewportSize();
    if (latest) {
      writeStoredSize(latest);
    }
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    const appWindow = getCurrentWindow();
    let cancelled = false;

    const restore = async () => {
      const stored = readStoredSize();
      if (!stored || cancelled) return;
      lastSizeRef.current = stored;
      try {
        await appWindow.setSize(new LogicalSize(stored.width, stored.height));
      } catch {
        // Ignore restore errors.
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    const appWindow = getCurrentWindow();
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    let scaleFactor: number | null = null;
    let lastPhysicalSize: WindowSizePayload | null = null;

    const schedulePersist = (size: WindowSizePayload) => {
      const previous = lastSizeRef.current;
      if (previous?.width === size.width && previous.height === size.height) return;
      lastSizeRef.current = size;
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
      }
      // Only write to local storage after the resize gesture settles.
      persistTimerRef.current = window.setTimeout(flushPersist, PERSIST_DELAY_MS);
    };

    const handleViewportResize = () => {
      // Fall back to the webview until native size and scale are available.
      if (scaleFactor != null && lastPhysicalSize != null) return;
      const size = readViewportSize();
      if (size) {
        schedulePersist(size);
      }
    };

    const persistPhysicalSize = ({ width, height }: WindowSizePayload, scale: number) => {
      schedulePersist({
        width: clampSize(width / scale),
        height: clampSize(height / scale),
      });
    };

    const trackListener = (registration: Promise<() => void>) => {
      void registration.then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      }).catch(() => { /* Webview resize remains available. */ });
    };

    trackListener(appWindow.onResized(({ payload }) => {
      if (cancelled) return;
      lastPhysicalSize = payload;
      if (scaleFactor != null) persistPhysicalSize(payload, scaleFactor);
    }));
    trackListener(appWindow.onScaleChanged(({ payload }) => {
      if (cancelled) return;
      scaleFactor = payload.scaleFactor;
      if (lastPhysicalSize != null) lastPhysicalSize = payload.size;
      persistPhysicalSize(payload.size, scaleFactor);
    }));
    // Resolve native DPI once. Moving between monitors supplies subsequent values.
    void appWindow.scaleFactor().then((scale) => {
      if (cancelled || scaleFactor != null) return;
      scaleFactor = scale;
      if (lastPhysicalSize != null) persistPhysicalSize(lastPhysicalSize, scale);
    }).catch(() => { /* Webview resize remains available. */ });
    window.addEventListener("resize", handleViewportResize);

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener("resize", handleViewportResize);
      flushPersist();
    };
  }, [flushPersist]);

  return { flushPersist };
};
