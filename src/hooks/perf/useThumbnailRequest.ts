// Schedules thumbnail request batches with a short delay for smoother scrolling.
import { useEffect, useRef } from "react";
import type { ThumbnailRequest } from "@/types";

const THUMB_REQUEST_DELAY = 80;

export const useThumbnailRequest = (
  loading: boolean,
  enabled: boolean,
  requests: ThumbnailRequest[],
  onRequest: (requests: ThumbnailRequest[]) => void,
  resetKey?: string,
) => {
  const timerRef = useRef<number | null>(null);
  const latestRequests = useRef<ThumbnailRequest[]>([]);

  useEffect(() => {
    if (loading || !enabled || requests.length === 0) return;
    latestRequests.current = requests;
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onRequest(latestRequests.current);
    }, THUMB_REQUEST_DELAY);
  }, [enabled, loading, onRequest, requests, resetKey]);

  useEffect(() => {
    if (!enabled || loading || requests.length === 0) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [enabled, loading, requests.length, resetKey]);

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
