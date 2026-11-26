// Remote profiles live outside the tab strip. Connecting alone keeps both panes intact.
import { useId, useRef, useState } from "react";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PATHBAR_TOOLTIP_DELAY_MS } from "@/constants";
import { NetworkIcon } from "@/components/icons/NetworkIcon";
import { PlusIcon, ServerIcon } from "@/components/icons";
import { useOverlayDismiss } from "@/components/overlay/useOverlayDismiss";
import { ToolbarPopover } from "@/components/primitives/ToolbarPopover";
import { toMessage } from "@/lib/fsUtils";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { connectRemote, disconnectRemote, removeRemoteProfile, useRemoteHosts, type RemoteProfile } from "@/modules/remoteHosts";
import { openRemoteTab } from "@/modules/remoteTabs";
import { RemoteHostEditor } from "./RemoteHostEditor";

type Page = { kind: "list" } | { kind: "edit"; profile?: RemoteProfile } | { kind: "remove"; profile: RemoteProfile };

export function RemoteHostPicker() {
  const { profiles, connections } = useRemoteHosts();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>({ kind: "list" });
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pane = useRef<"main" | "bottom">("main");
  const interaction = useRef(0);
  const work = useRef(0);
  const id = useId();
  const reset = () => { setPage({ kind: "list" }); setMenu(null); setError(""); };
  const close = () => { interaction.current++; setOpen(false); reset(); };

  useOverlayDismiss({ enabled: open, refs: [root], onPointerDownOutside: close, keydownCapture: true,
    onEscape: event => {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.current?.focus({ preventScroll: true });
    } });

  const run = async (profile: RemoteProfile, action: "open" | "connect" | "disconnect" | "remove") => {
    const token = ++interaction.current;
    const job = ++work.current;
    setWorking(profile.id);
    setError("");
    setMenu(null);
    try {
      if (action === "remove") {
        await removeRemoteProfile(profile.id);
        if (token === interaction.current) reset();
      } else if (action === "disconnect") {
        await disconnectRemote(profile.id);
      } else {
        const path = await connectRemote(profile);
        if (action === "open" && token === interaction.current) {
          openRemoteTab(profile.id, path, pane.current);
          close();
        }
      }
    } catch (failure) {
      if (token === interaction.current) setError(toMessage(failure, "Remote connection failed."));
    } finally {
      if (job === work.current) setWorking(null);
    }
  };

  return <div ref={root} className="remote-picker" data-remotes-picker="true" data-window-drag-ignore="true"
    onKeyDown={event => { if (open) event.stopPropagation(); }}>
    <TooltipWrapper text="Remote hosts" delayMs={PATHBAR_TOOLTIP_DELAY_MS}>
    <button ref={button} type="button" className="remote-trigger" aria-label="Remote hosts"
      aria-description={`${profiles.length} saved hosts`} aria-haspopup="dialog" aria-controls={open ? id : undefined} aria-expanded={open}
      onClick={() => {
        if (open) return close();
        const { open: split, active } = useBottomPaneStore.getState();
        pane.current = split && active ? "bottom" : "main";
        setOpen(true);
      }}>
      <NetworkIcon />
      {profiles.length > 0 && <span className="tnum">{profiles.length}</span>}
    </button>
    </TooltipWrapper>
    {open && <ToolbarPopover id={id} role="dialog" aria-label="Remote hosts" className="remote-popover"
      heading={page.kind === "edit" ? (page.profile ? "Edit host" : "Add host") : page.kind === "remove" ? "Remove host?" : "Remote hosts"}
      headerAction={page.kind === "list" && <button type="button" className="remote-action"
        disabled={Boolean(working)} onClick={() => { reset(); setPage({ kind: "edit" }); }}><PlusIcon />Add host</button>}>
      {page.kind === "edit" ? <RemoteHostEditor profile={page.profile} onClose={reset} />
        : page.kind === "remove" ? <div className="remote-remove">
          <p>Disconnect and remove {page.profile.name}?</p>
          <div className="remote-editor-actions">
            <button className="btn ghost" disabled={Boolean(working)} onClick={reset}>Cancel</button>
            <button className="btn" disabled={Boolean(working)} onClick={() => void run(page.profile, "remove")}>Remove host</button>
          </div>
        </div>
        : profiles.length ? <ul className="toolbar-popover-list remote-list">
          {profiles.map(profile => {
            const status = connections[profile.id]?.status ?? "disconnected";
            const busy = Boolean(working) || status === "connecting";
            const selected = menu === profile.id;
            return <li key={profile.id}>
              <div className="remote-row">
                <TooltipWrapper text={`Open folder on ${profile.destination}`}>
                <button type="button" className="remote-open" disabled={busy}
                  aria-label={`Open folder on ${profile.name}`}
                  onClick={() => void run(profile, "open")}>
                  <ServerIcon />
                  <span className="remote-name">{profile.name}</span>
                  <small className="remote-state" data-connected={status === "connected"}>
                    {status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Disconnected"}
                  </small>
                </button>
                </TooltipWrapper>
                {status === "connecting" ? <button type="button" className="remote-action"
                  onClick={() => void run(profile, "disconnect")}>Cancel</button> :
                <button type="button" aria-label={`Actions for ${profile.name}`} aria-expanded={selected}
                  className="remote-action" disabled={busy} onClick={() => { setMenu(selected ? null : profile.id); setError(""); }}>•••</button>}
              </div>
              {selected && <div className="remote-row-actions">
                <button type="button" className="remote-action" onClick={() => void run(profile, status === "connected" ? "disconnect" : "connect")}>
                  {status === "connected" ? "Disconnect" : "Connect"}</button>
                <button type="button" className="remote-action" onClick={() => setPage({ kind: "edit", profile })}>Edit</button>
                <button type="button" className="remote-action" onClick={() => setPage({ kind: "remove", profile })}>Remove</button>
              </div>}
            </li>;
          })}
        </ul> : <p className="remote-placeholder">No saved hosts.</p>}
      {error && <p role="alert" className="remote-error">{error}</p>}
    </ToolbarPopover>}
  </div>;
}
