// The native profile owns subscriptions. Only receiver origins appear in the list.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DeleteActionIcon, PlayIcon, PlusIcon } from "@/components/icons";
import { ContextRenameIcon } from "@/components/icons/contextMenuIcons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { toMessage } from "@/lib/fsUtils";
import { SettingsItem } from "./SettingsItem";
import { WebhookEditor, type Webhook, type WebhookEdit } from "./WebhookEditor";

export const WEBHOOK_ITEM = {
  label: "Webhooks",
  description: "Send file and transfer events to a URL. Retry failed deliveries in Work.",
  keywords: "subscriptions automation integration destination event JSON bearer token privacy backup",
};
type Config = { hooks: Webhook[]; eventTypes: string[] };
type TestResult = "Queued" | "Delivered" | "Delivery failed · Retry in Work";
const load = () => invoke<Config>("webhook_settings");

export function SettingsWebhooksSection() {
  const [config, setConfig] = useState<Config>();
  const [editor, setEditor] = useState<Webhook | "new" | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult | undefined>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let closed = false;
    load().then(data => { if (!closed) setConfig(data); })
      .catch(cause => { if (!closed) setError(toMessage(cause, "Could not load webhooks.")); });
    const stop = listen<{ hook: string; ok: boolean }>("webhook-test-finished", ({ payload }) => {
      if (!closed) setTests(prev => ({ ...prev, [payload.hook]: payload.ok ? "Delivered" : "Delivery failed · Retry in Work" }));
    });
    void stop.catch(() => { if (!closed) setError("Test status unavailable. Check Work for failures."); });
    return () => { closed = true; void stop.then(fn => fn()).catch(() => {}); };
  }, []);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); }
    catch (cause) { setError(toMessage(cause, "Could not update the webhook.")); }
    finally { setBusy(false); }
  }

  function openEditor(hook: Webhook | "new" | null) {
    setRemove(null);
    setError("");
    setEditor(hook);
  }

  async function save(data: WebhookEdit) {
    await invoke("webhook_save", { edit: data });
    setEditor(null);
    setConfig(await load());
  }

  async function sendTest(id: string) {
    setTests(prev => ({ ...prev, [id]: "Queued" }));
    try { await invoke("webhook_test", { id }); }
    catch (cause) { setTests(prev => ({ ...prev, [id]: undefined })); throw cause; }
  }

  return <section className="settings-section webhook-settings" id="settings-webhooks" aria-label="Webhooks">
    {editor && config ? (
      <WebhookEditor hook={editor === "new" ? undefined : editor} types={config.eventTypes} busy={busy}
        save={data => void act(() => save(data))} cancel={() => openEditor(null)} />
    ) : (
      <>
        <SettingsItem item={WEBHOOK_ITEM} className="webhook-heading">
          {config && <TooltipWrapper text="Choose a destination and events">
            <PressButton className="btn webhook-add" type="button" onClick={() => openEditor("new")} disabled={busy}>
              <PlusIcon /> Add webhook
            </PressButton>
          </TooltipWrapper>}
        </SettingsItem>
        {config?.hooks.map(hook => <div className="webhook-row" key={hook.id}>
          <div className="webhook-identity">
            <strong className="settings-label">{hook.name}</strong>
            <span className="settings-desc">{hook.origin} · {hook.enabled ? "Enabled" : "Paused"}</span>
            {tests[hook.id] && <span className="settings-desc" role="status">{tests[hook.id]}</span>}
          </div>
          {remove === hook.id ? <div className="webhook-confirm">
            <span className="settings-desc">Remove this webhook and its queued deliveries?</span>
            <div className="settings-actions">
              <PressButton type="button" className="btn ghost" disabled={busy} onClick={() => setRemove(null)}>Cancel</PressButton>
              <PressButton type="button" className="btn" disabled={busy} onClick={() => void act(async () => {
                await invoke("webhook_remove", { id: hook.id });
                setRemove(null);
                setConfig(await load());
              })}>Remove</PressButton>
            </div>
          </div> : <div className="settings-actions" role="group" aria-label={hook.name}>
            <ToolbarIconButton label="Send test event" disabled={busy} onClick={() => void act(() => sendTest(hook.id))}><PlayIcon /></ToolbarIconButton>
            <ToolbarIconButton label="Edit webhook" disabled={busy} onClick={() => openEditor(hook)}><ContextRenameIcon /></ToolbarIconButton>
            <ToolbarIconButton label="Remove webhook" disabled={busy} onClick={() => setRemove(hook.id)}><DeleteActionIcon /></ToolbarIconButton>
          </div>}
        </div>)}
      </>
    )}
    {error && <div className="webhook-feedback">
      <span className="settings-desc settings-desc-error" role="alert">{error}</span>
      {!config && <PressButton className="btn ghost" disabled={busy} onClick={() => void act(async () => setConfig(await load()))}>Reload</PressButton>}
    </div>}
  </section>;
}
