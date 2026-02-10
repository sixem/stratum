// Schedules thumbnail request batches with a short delay for smoother scrolling.
import { useEffect, useRef } from "react";
import type { ThumbnailRequest } from "@/types";

const THUMB_REQUEST_DELAY = 80;

const buildThumbRequestSignature = (requests: ThumbnailRequest[]) => {
  return requests
    .map((request) => {
      const size = request.size ?? "none";
      const modified = request.modified ?? "none";
      const signature = request.signature ?? "none";
      return `${request.path}|${size}|${modified}|${signature}`;
    })
    .join("||");
};

export const useThumbnailRequest = (
  loading: boolean,
  enabled: boolean,
  requests: ThumbnailRequest[],
  onRequest: (requests: ThumbnailRequest[]) => void,
  resetKey?: string,
) => {
  const timerRef = useRef<number | null>(null);
  const latestRequests = useRef<ThumbnailRequest[]>([]);
  const pendingSignatureRef = useRef("");
  const lastDispatchedSignatureRef = useRef("");
  const lastResetKeyRef = useRef<string | undefined>(resetKey);

  useEffect(() => {
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      pendingSignatureRef.current = "";
      lastDispatchedSignatureRef.current = "";
    }
    if (loading || !enabled || requests.length === 0) return;

    const signature = buildThumbRequestSignature(requests);
    if (lastDispatchedSignatureRef.current === signature && timerRef.current == null) {
      return;
    }

    latestRequests.current = requests;
    pendingSignatureRef.current = signature;
    if (timerRef.current != null) return;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastDispatchedSignatureRef.current = pendingSignatureRef.current;
      onRequest(latestRequests.current);
    }, THUMB_REQUEST_DELAY);
  }, [enabled, loading, onRequest, requests, resetKey]);

  useEffect(() => {
    if (!enabled || loading || requests.length === 0) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingSignatureRef.current = "";
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
      pendingSignatureRef.current = "";
    };
  }, []);
};
