import { useEffect, useRef } from "react";
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
    let unlistenResize: (() => void) | null = null;
    let unlistenScale: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;
    let cancelled = false;

    const schedulePersist = (size: WindowSizePayload) => {
      lastSizeRef.current = size;
      if (persistTimerRef.current != null) return;
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        const latest = lastSizeRef.current;
        if (latest) {
          writeStoredSize(latest);
        }
      }, PERSIST_DELAY_MS);
    };

    const flushPersist = () => {
      const latest = lastSizeRef.current ?? readViewportSize();
      if (latest) {
        writeStoredSize(latest);
      }
    };

    const handleViewportResize = () => {
      const size = readViewportSize();
      if (size) {
        schedulePersist(size);
      }
    };

    const handlePhysicalSize = async (size: { toLogical: (scale: number) => LogicalSize }) => {
      try {
        const scale = await appWindow.scaleFactor();
        if (cancelled) return;
        const logical = size.toLogical(scale);
        schedulePersist({
          width: clampSize(logical.width),
          height: clampSize(logical.height),
        });
      } catch {
        // Ignore resize conversion errors.
      }
    };

    const setup = async () => {
      unlistenResize = await appWindow.onResized((event) => {
        void handlePhysicalSize(event.payload);
      });
      unlistenScale = await appWindow.onScaleChanged((event) => {
        const logical = event.payload.size.toLogical(event.payload.scaleFactor);
        schedulePersist({
          width: clampSize(logical.width),
          height: clampSize(logical.height),
        });
      });
      unlistenClose = await appWindow.onCloseRequested(() => {
        flushPersist();
      });
    };

    window.addEventListener("resize", handleViewportResize);

    void setup();

    return () => {
      cancelled = true;
      if (unlistenResize) {
        unlistenResize();
      }
      if (unlistenScale) {
        unlistenScale();
      }
      if (unlistenClose) {
        unlistenClose();
      }
      window.removeEventListener("resize", handleViewportResize);
      flushPersist();
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, []);
};
