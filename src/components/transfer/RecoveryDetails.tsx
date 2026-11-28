// Recovery stays in Work even after every ordinary job has been cleared.
import { useState } from "react";
import { toMessage } from "@/lib/fsUtils";
import { acknowledgeRecovery, checkInterruptedOperations, refreshRecovery, useRecovery, type RecoveryDetail } from "@/modules/remoteRecovery";
import { useRemoteHosts } from "@/modules/remoteHosts";

function RecoveryItem({ item }: { item: RecoveryDetail }) {
  const [busy, setBusy] = useState<"acknowledge" | "retry" | null>(null);
  const [error, setError] = useState("");
  const session = useRemoteHosts(s => {
    const profile = s.profiles.find(p => p.destination === item.host);
    const sessionId = profile && s.connections[profile.id]?.sessionId;
    return sessionId && profile ? { profileId: profile.id, sessionId } : null;
  });
  const partial = item.state === "restored_partial" || item.state === "deleting" || item.state === "published";
  const needsRestore = item.state !== "restored_partial" && item.kind !== "destination";
  const act = async (action: "acknowledge" | "retry") => {
    setBusy(action);
    setError("");
    try {
      if (action === "acknowledge") await acknowledgeRecovery(item);
      else if (session) await checkInterruptedOperations(session.profileId, session.sessionId, item.host);
    } catch (cause) { setError(toMessage(cause, "Could not update recovery.")); }
    finally { setBusy(null); }
  };
  return <article className="recovery-item">
    <strong>{item.kind === "delete" ? "Interrupted delete" : item.kind === "move" ? "Interrupted move" : "Incomplete transfer"} · {item.host || "This PC"}</strong>
    <dl>
      {item.original && (item.original !== item.location || item.sourceHost !== item.host) &&
        <><dt>Item</dt><dd>{item.sourceHost && item.sourceHost !== item.host ? `${item.sourceHost}:` : ""}{item.original}</dd></>}
      <dt>{item.state === "restored_partial" ? "Check original" : "Check location"}</dt><dd>{item.location}</dd>
    </dl>
    {partial && <p>Some original contents may already have been deleted.</p>}
    <p>{needsRestore ? "Recovery retries on reconnect, even after acknowledgement." : "Acknowledging closes this notice and keeps all remaining files."}</p>
    <div className="recovery-actions">
      {needsRestore && session && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void act("retry")}>
        {busy === "retry" ? "Checking…" : "Retry host recovery"}
      </button>}
      <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void act("acknowledge")}>
        {busy === "acknowledge" ? "Saving…" : "Acknowledge"}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
  </article>;
}

export function RecoveryDetails() {
  const { details, error } = useRecovery();
  if (!details.length && !error) return null;
  return <section className="recovery-details" aria-label="SFTP recovery">
    <h3>SFTP recovery</h3>
    {error && <p role="alert">{error} <button className="btn ghost" onClick={() => void refreshRecovery()}>Retry</button></p>}
    {details.map(item => <RecoveryItem key={item.kind + item.id} item={item} />)}
  </section>;
}
