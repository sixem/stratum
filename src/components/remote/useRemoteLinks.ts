import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RemoteEntry } from "./remoteDirectory";

export type LinkTarget = { kind: "file" | "directory"; path: string };
export const resolveRemoteLink = (profileId: string, sessionId: number, path: string) =>
  invoke<LinkTarget>("remote_link_target", { profileId, sessionId, path });

// Only inspect visible links, one at a time, without delaying a directory listing.
export function useRemoteLinks(entries: RemoteEntry[], visible: RemoteEntry[], profileId: string, sessionId: number) {
  const [resolved, setResolved] = useState<Map<string, LinkTarget | null>>(new Map());
  const latest = useRef(resolved);
  latest.current = resolved;
  useEffect(() => {
    setResolved(new Map());
  }, [entries, profileId, sessionId]);
  useEffect(() => {
    let active = true;
    void (async () => {
      for (const entry of visible) {
        if (!active) return;
        if (!entry.isSymlink || latest.current.has(entry.path)) continue;
        const result = await resolveRemoteLink(profileId, sessionId, entry.path).catch(() => null);
        if (!active) return;
        setResolved(previous => new Map(previous).set(entry.path, result));
      }
    })();
    return () => { active = false; };
  }, [visible, profileId, sessionId, entries]);
  return useMemo(() => entries.map(entry => {
    if (!entry.isSymlink || !resolved.has(entry.path)) return entry;
    const target = resolved.get(entry.path);
    return { ...entry, isDir: target?.kind === "directory", symlinkTarget: target?.kind ?? "unavailable" } as RemoteEntry;
  }), [entries, resolved]);
}
