// Failed requests keep their original event IDs when retried from Work.
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toMessage } from "@/lib/fsUtils";
import { refreshWebhookWork, useWebhookWork } from "@/modules/webhookWork";

export function WebhookFailures() {
  const { failures, total, missed, error } = useWebhookWork();
  const [busy, setBusy] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  if (!total && !missed && !error && !feedback) return null;
  async function act(command: "webhook_retry" | "webhook_dismiss", id: number | null) {
    setBusy(id ?? -1);
    setFeedback("");
    try { await invoke(command, { id }); }
    catch (cause) { setFeedback(toMessage(cause, "Could not update the delivery.")); }
    finally { await refreshWebhookWork(); setBusy(null); }
  }

  return <section className="recovery-details" aria-label="Webhook deliveries">
    <h3>Webhook deliveries</h3>
    {error && <p role="alert">{error} <button className="btn ghost" onClick={() => void refreshWebhookWork()}>Refresh</button></p>}
    {feedback && <p role="alert">{feedback}</p>}
    {missed > 0 && <article className="recovery-item">
      <strong>Event buffer filled</strong>
      <p>{missed} operation {missed === 1 ? "event expired" : "events expired"} before Stratum could queue delivery.</p>
      <button className="btn ghost" disabled={busy !== null} onClick={() => void act("webhook_dismiss", null)}>Dismiss</button>
    </article>}
    {total > failures.length && <p>Showing the oldest {failures.length} of {total} failures.</p>}
    {failures.map(row => <article key={row.id} className="recovery-item">
      <strong>{row.name} · {row.kind}</strong>
      <dl><dt>Receiver</dt><dd>{row.origin}</dd><dt>Event ID</dt><dd>{row.eventId}</dd></dl>
      <p>{row.error} {row.attempts} {row.attempts === 1 ? "attempt" : "attempts"}.</p>
      {!row.canRetry && <p>Enable the webhook and restore its original destination to retry.</p>}
      <div className="recovery-actions">
        <button type="button" className="btn" disabled={busy !== null || !row.canRetry} onClick={() => void act("webhook_retry", row.id)}>Retry</button>
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void act("webhook_dismiss", row.id)}>Dismiss</button>
      </div>
    </article>)}
  </section>;
}
