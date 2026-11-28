// URLs and tokens are write-only after saving. Blank fields preserve stored credentials.
import { useState } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { SettingsCheckbox } from "./SettingsCheckbox";
import { SettingsPills } from "./SettingsPills";

export type Webhook = { id: string; name: string; origin: string; enabled: boolean; events: string[]; hasToken: boolean };
export type WebhookEdit = Pick<Webhook, "name" | "enabled" | "events"> & { id?: string; url?: string; token?: string };

const eventGroups = [
  ["file", "Files", "One event per file changed."],
  ["directory", "Folders", "One event per folder changed."],
  ["transfer", "Transfers", "One outcome per copy or move job."],
] as const;

export function WebhookEditor({ hook, types, busy, save, cancel }: {
  hook?: Webhook; types: string[]; busy: boolean; save: (edit: WebhookEdit) => void; cancel: () => void;
}) {
  const [name, setName] = useState(hook?.name ?? "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [enabled, setEnabled] = useState(hook?.enabled ?? false);
  const [events, setEvents] = useState(hook?.events ?? ["transfer.completed", "transfer.failed", "transfer.cancelled"]);

  return <form className="webhook-editor" onSubmit={event => {
    event.preventDefault();
    save({ id: hook?.id, name, enabled, events, url: url.trim() || undefined,
      token: clearToken ? "" : token || undefined });
  }}>
    <fieldset disabled={busy}>
      <legend className="settings-section-title">{hook ? "Edit webhook" : "Add webhook"}</legend>
      <div className="webhook-fields">
        <label className="webhook-field">Name
          <input name="name" autoFocus className="settings-backup-input" required maxLength={80} value={name}
            onChange={event => setName(event.target.value)} />
        </label>
        <label className="webhook-field">{hook ? "Replace URL" : "Destination URL"}
          <input name="url" className="settings-backup-input" type="password" autoComplete="off" spellCheck={false}
            required={!hook} value={url} onChange={event => setUrl(event.target.value)}
            placeholder={hook ? `Saved at ${hook.origin}` : "https://example.com/webhook"} />
        </label>
        <label className="webhook-field">Bearer token
          <input name="token" className="settings-backup-input" type="password" autoComplete="new-password"
            spellCheck={false} value={token} disabled={clearToken} onChange={event => setToken(event.target.value)}
            placeholder={hook?.hasToken ? "Saved token" : "Optional"} />
        </label>
        {hook?.hasToken && <SettingsCheckbox checked={clearToken} onChange={e => setClearToken(e.target.checked)}>Remove saved token</SettingsCheckbox>}
        <p className="settings-desc">{hook && url.trim()
          ? "Changing the URL clears its token. Queued deliveries keep their original destination."
          : "URLs and tokens are encrypted and excluded from backups."}</p>
      </div>
      <div className="webhook-types">
        <div className="settings-label">Events</div>
        <p className="settings-desc">Item events include file paths and, for SFTP, host IDs.</p>
        {eventGroups.map(([prefix, label, description]) =>
          <div className="webhook-field" key={prefix}>
            <div><span>{label}</span><p className="settings-desc">{description}</p></div>
            <SettingsPills aria-label={label}>
              {types.filter(type => type.startsWith(prefix + ".")).map(type => {
                const verb = type.slice(prefix.length + 1);
                const selected = events.includes(type);
                return <PressButton key={type} type="button" aria-pressed={selected}
                  className={`settings-pill${selected ? " is-active" : ""}`}
                  onClick={() => setEvents(current => current.includes(type)
                    ? current.filter(value => value !== type) : [...current, type])}>
                  {verb[0].toUpperCase() + verb.slice(1)}
                </PressButton>;
              })}
            </SettingsPills>
          </div>)}
      </div>
      <div className="webhook-editor-footer">
        <SettingsCheckbox checked={enabled} onChange={event => setEnabled(event.target.checked)}>Enable webhook</SettingsCheckbox>
        <div className="settings-actions">
          <PressButton type="button" className="btn ghost" onClick={cancel}>Cancel</PressButton>
          <PressButton type="submit" className="btn" pressOnPointerDown={false}
            disabled={!name.trim() || !events.length || (!hook && !url.trim())}>Save</PressButton>
        </div>
      </div>
    </fieldset>
  </form>;
}
