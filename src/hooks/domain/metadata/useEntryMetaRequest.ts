import { useEffect, useRef } from "react";

const META_REQUEST_DELAY = 70;

const buildMetaRequestSignature = (paths: string[]) => paths.join("||");

export const useEntryMetaRequest = (
  loading: boolean,
  paths: string[],
  onRequestMeta: (paths: string[]) => Promise<unknown>,
) => {
  const timerRef = useRef<number | null>(null);
  const latestPaths = useRef<string[]>([]);
  const pendingSignatureRef = useRef("");
  const lastDispatchedSignatureRef = useRef("");

  useEffect(() => {
    // Cancel work for the previous handler before the next effect schedules it again.
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingSignatureRef.current = "";
      lastDispatchedSignatureRef.current = "";
    };
  }, [onRequestMeta]);

  useEffect(() => {
    if (loading || paths.length === 0) return;

    const signature = buildMetaRequestSignature(paths);
    if (lastDispatchedSignatureRef.current === signature && timerRef.current == null) {
      return;
    }

    latestPaths.current = paths;
    pendingSignatureRef.current = signature;
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastDispatchedSignatureRef.current = pendingSignatureRef.current;
      void onRequestMeta(latestPaths.current).catch(() => {
        // Ignore metadata request errors; the view can still render base entries.
      });
    }, META_REQUEST_DELAY);
  }, [loading, onRequestMeta, paths]);

  useEffect(() => {
    if (loading || paths.length === 0) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingSignatureRef.current = "";
    }
  }, [loading, paths.length]);
};
