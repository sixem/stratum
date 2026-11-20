// Request a preview capability for the current selection and release it on exit.
import { useEffect, useMemo, useState } from "react";
import { createPreviewGrant, releasePreviewGrant } from "@/api/preview";
import { buildPreviewUrl } from "@/lib/previewUrl";

export const usePreviewSource = (path: string | null) => {
  const request = useMemo(() => ({ path }), [path]);
  const [resolved, setResolved] = useState<{ request: typeof request; src: string } | null>(null);

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
        const grant = await createPreviewGrant(selectedPath);
        if (!active) {
          void release(grant);
          return;
        }
        token = grant;
        setResolved({ request, src: buildPreviewUrl(grant) });
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
  return { src: current?.src ?? "", failed: current?.src === "" };
};
