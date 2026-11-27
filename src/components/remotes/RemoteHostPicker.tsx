// Remote profiles live outside the tab strip. Connecting alone keeps both panes intact.
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { ContextMoreOptionsIcon, ContextOpenFolderIcon } from "@/components/icons/contextMenuIcons";
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
  const [menu, setMenu] = useState<{
    profile: RemoteProfile; x: number; y: number; anchor: { left: number; right: number };
  } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pane = useRef<"main" | "bottom">("main");
  const interaction = useRef(0);
  const work = useRef(0);
  const id = useId();
  const reset = () => { setPage({ kind: "list" }); setMenu(null); setError(""); };
  const close = () => { interaction.current++; setOpen(false); reset(); };

  useOverlayDismiss({ enabled: open, refs: [root, menuRoot], onPointerDownOutside: close, keydownCapture: true,
    onEscape: event => {
      event.preventDefault();
      event.stopPropagation();
      if (menu) {
        setMenu(null);
        return;
      }
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
            const selected = menu?.profile.id === profile.id;
            return <li key={profile.id}>
              <div className="remote-row">
                <div className="remote-host">
                  <ServerIcon />
                  <span className="remote-name">{profile.name}</span>
                </div>
                <small className="remote-state" data-status={status}>
                  {status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Disconnected"}
                </small>
                <TooltipWrapper text={`Open folder on ${profile.name}`} delayMs={PATHBAR_TOOLTIP_DELAY_MS}>
                  <button type="button" className="remote-action" disabled={busy}
                    aria-label={`Open folder on ${profile.name}`} onClick={() => void run(profile, "open")}>
                    <ContextOpenFolderIcon />
                  </button>
                </TooltipWrapper>
                {status === "connecting" ? <button type="button" className="remote-action"
                  onClick={() => void run(profile, "disconnect")}>Cancel</button> :
                <button type="button" aria-label={`Actions for ${profile.name}`} aria-haspopup="menu" aria-expanded={selected}
                  className="remote-action" disabled={busy} onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const parent = event.currentTarget.closest(".remote-popover")?.getBoundingClientRect() ?? rect;
                    menuTrigger.current = event.currentTarget;
                    setMenu(selected ? null : {
                      profile, x: rect.right, y: rect.top, anchor: { left: parent.left, right: parent.right },
                    });
                    setError("");
                  }}><ContextMoreOptionsIcon /></button>}
              </div>
            </li>;
          })}
        </ul> : <p className="remote-placeholder">No saved hosts.</p>}
      {error && <p role="alert" className="remote-error">{error}</p>}
    </ToolbarPopover>}
    {open && menu && createPortal(<div ref={menuRoot} data-remotes-picker="true">
      <ContextMenu open x={menu.x} y={menu.y} horizontalAnchor={menu.anchor} dismissIgnoreRef={menuTrigger} focusFirstItem items={[
        {
          id: "remote-toggle-connection",
          label: connections[menu.profile.id]?.status === "connected" ? "Disconnect" : "Connect",
          onSelect: () => void run(menu.profile, connections[menu.profile.id]?.status === "connected" ? "disconnect" : "connect"),
        },
        { id: "remote-edit", label: "Edit", icon: "rename", onSelect: () => setPage({ kind: "edit", profile: menu.profile }) },
        { id: "remote-remove", label: "Remove", icon: "remove", onSelect: () => setPage({ kind: "remove", profile: menu.profile }) },
      ]} onClose={() => setMenu(null)} />
    </div>, document.body)}
  </div>;
}
