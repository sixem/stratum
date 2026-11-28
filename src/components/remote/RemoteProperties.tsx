// Read metadata only while the properties dialog is open.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, formatDate } from "@/lib/format";
import { toMessage } from "@/lib/fsUtils";
import { usePromptStore } from "@/modules/promptStore";
import { useRemoteHosts } from "@/modules/remoteHosts";

type RemoteItem = { profileId: string; sessionId: number; path: string };
type Properties = {
  size: string | null; modified: number | null; permissions: number | null;
  isSymlink: boolean; linkTarget: string | null;
};

function sizeLabel(value: string | null) {
  if (value === null) return "Unavailable";
  const size = BigInt(value);
  const summary = formatBytes(Number(size));
  return size < 1024n ? summary : `${summary} (${size.toLocaleString()} bytes)`;
}

function formatPermissions(mode: number) {
  const groups = [6, 3, 0].map((shift, index) => {
    const bits = mode >> shift;
    const special = mode & (0o4000 >> index);
    const letter = index === 2 ? "t" : "s";
    const execute = special ? (bits & 1 ? letter : letter.toUpperCase()) : (bits & 1 ? "x" : "-");
    return (bits & 4 ? "r" : "-") + (bits & 2 ? "w" : "-") + execute;
  });
  return `${groups.join("")} (${mode.toString(8).padStart(4, "0")})`;
}

function RemoteProperties({ item, host }: { item: RemoteItem; host: string }) {
  const [data, setData] = useState<Properties>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    invoke<Properties>("remote_properties", item).then(result => {
      if (active) setData(result);
    }, cause => { if (active) setError(toMessage(cause, "Could not read remote properties.")); });
    return () => { active = false; };
  }, [item]);
  return <>
    <dl className="remote-properties">
      <dt>Host</dt><dd>{host}</dd>
      <dt>Path</dt><dd>{item.path}</dd>
      {data && <>
        <dt>Size</dt><dd>{sizeLabel(data.size)}</dd>
        <dt>Modified</dt><dd>{data.modified == null ? "Unavailable" : formatDate(data.modified)}</dd>
        <dt>Permissions</dt><dd className="remote-mode">{data.permissions == null ? "Unavailable" : formatPermissions(data.permissions)}</dd>
        {data.isSymlink && <><dt>Link target</dt><dd>{data.linkTarget ?? "Unavailable"}</dd></>}
      </>}
    </dl>
    {!data && <div role={error ? "alert" : "status"}>{error || "Reading properties…"}</div>}
  </>;
}

export function showRemoteProperties(item: RemoteItem) {
  const profile = useRemoteHosts.getState().profiles.find(host => host.id === item.profileId);
  usePromptStore.getState().showPrompt({ title: "Remote properties", confirmLabel: "Close", cancelLabel: null, queued: true,
    content: <RemoteProperties key={JSON.stringify(item)} item={item} host={profile?.destination ?? "Unavailable"} /> });
}
