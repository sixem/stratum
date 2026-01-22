import { useEffect, useRef } from "react";

const THUMB_REQUEST_DELAY = 80;

export const useThumbnailRequest = (
  loading: boolean,
  enabled: boolean,
  paths: string[],
  onRequest: (paths: string[]) => void,
  resetKey?: string,
) => {
  const timerRef = useRef<number | null>(null);
  const latestPaths = useRef<string[]>([]);

  useEffect(() => {
    if (loading || !enabled || paths.length === 0) return;
    latestPaths.current = paths;
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onRequest(latestPaths.current);
    }, THUMB_REQUEST_DELAY);
  }, [enabled, loading, onRequest, paths, resetKey]);

  useEffect(() => {
    if (!enabled || loading || paths.length === 0) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [enabled, loading, paths.length, resetKey]);

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [onRequest]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
};
