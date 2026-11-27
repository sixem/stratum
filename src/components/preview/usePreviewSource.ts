// Request a preview capability for the current selection and release it on exit.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createPreviewGrant, releasePreviewGrant } from "@/api/preview";
import { buildPreviewUrl } from "@/lib/previewUrl";

export const usePreviewSource = (path: string | null, remote?: { profileId: string; sessionId: number }) => {
  const request = useMemo(() => ({ path, profileId: remote?.profileId, sessionId: remote?.sessionId }), [path, remote?.profileId, remote?.sessionId]);
  const [resolved, setResolved] = useState<{ request: typeof request; src: string; token?: string } | null>(null);

  useEffect(() => {
    if (!request.path) return;
    const selectedPath = request.path;
    let active = true;
    let token: string | undefined;

    const release = async (grant: string) => {
      try {
        await releasePreviewGrant(grant);
      } catch {
        // Native expiration covers a WebView shutdown during cleanup.
      }
    };

    const authorize = async () => {
      try {
        const grant = request.profileId && request.sessionId !== undefined
          ? await invoke<string>("create_remote_preview_grant", { path: selectedPath, profileId: request.profileId, sessionId: request.sessionId })
          : await createPreviewGrant(selectedPath);
        if (!active) {
          void release(grant);
          return;
        }
        token = grant;
        setResolved({ request, src: buildPreviewUrl(grant), token: grant });
      } catch {
        if (active) setResolved({ request, src: "" });
      }
    };
    void authorize();

    return () => {
      active = false;
      if (token) void release(token);
    };
  }, [request]);

  // A late result or previous URL must not display after changing files.
  const current = resolved?.request === request ? resolved : null;
  return { src: current?.src ?? "", token: current?.token, failed: current?.src === "" };
};
