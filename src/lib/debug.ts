// Debug utilities for structured, colorful, timestamped logging.
import createDebug from "debug";
import type { Debugger } from "debug";

const BASE_NAMESPACE = "stratum";
const DEFAULT_NAMESPACE = `${BASE_NAMESPACE}:*`;

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const formatTimestamp = (date: Date) => {
  const ms = `${date.getMilliseconds()}`.padStart(3, "0");
  return `${TIME_FORMAT.format(date)}.${ms}`;
};

let initialized = false;
let formatPatched = false;

const patchFormatArgs = () => {
  if (formatPatched) return;
  formatPatched = true;
  const original = createDebug.formatArgs;

  // Prepend a compact timestamp to every debug line.
  createDebug.formatArgs = function (args) {
    const stamp = formatTimestamp(new Date());
    args[0] = `${stamp} ${args[0]}`;
    original.call(this, args);
  };
};

type DebugWithLoad = typeof createDebug & {
  load?: () => string | undefined;
};
const debugWithLoad = createDebug as DebugWithLoad;

const loadStoredNamespaces = () => {
  try {
    if (typeof debugWithLoad.load === "function") {
      return debugWithLoad.load();
    }
    return localStorage.getItem("debug") ?? undefined;
  } catch {
    return undefined;
  }
};

export const initDebug = () => {
  if (initialized) return;
  initialized = true;

  // Prefer console.debug so browser devtools can filter debug logs easily.
  createDebug.log = console.debug.bind(console);
  patchFormatArgs();

  // Always enable a namespace set in development.
  if (import.meta.env.MODE === "development") {
    const stored = loadStoredNamespaces();
    const namespaces = stored && stored.length > 0 ? stored : DEFAULT_NAMESPACE;
    createDebug.enable(namespaces);
    const initLog = createDebug(`${BASE_NAMESPACE}:init`);
    initLog("debug enabled: %s", namespaces);
  }
};

export const makeDebug = (namespace: string): Debugger =>
  createDebug(`${BASE_NAMESPACE}:${namespace}`);

export const measure = <T>(logger: Debugger, label: string, work: () => T): T => {
  if (!logger.enabled) return work();
  const start = performance.now();
  const result = work();
  logger("%s took %dms", label, Math.round(performance.now() - start));
  return result;
};

export const measureAsync = async <T>(
  logger: Debugger,
  label: string,
  work: () => Promise<T>,
): Promise<T> => {
  if (!logger.enabled) return work();
  const start = performance.now();
  const result = await work();
  logger("%s took %dms", label, Math.round(performance.now() - start));
  return result;
};
