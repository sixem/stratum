import { useEffect, useRef } from "react";

const META_REQUEST_DELAY = 70;

export const useEntryMetaRequest = (
  loading: boolean,
  paths: string[],
  onRequestMeta: (paths: string[]) => Promise<unknown>,
) => {
  const timerRef = useRef<number | null>(null);
  const latestPaths = useRef<string[]>([]);

  useEffect(() => {
    if (loading || paths.length === 0) return;

    latestPaths.current = paths;
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onRequestMeta(latestPaths.current);
    }, META_REQUEST_DELAY);
  }, [loading, onRequestMeta, paths]);

  useEffect(() => {
    if (loading || paths.length === 0) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [loading, paths.length]);

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [onRequestMeta]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
};
