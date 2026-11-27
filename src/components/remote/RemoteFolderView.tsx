// Remote tabs use the familiar folder controls without invoking Windows shell, watcher or transfer actions.
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/primitives/EmptyState";
import { useSettingsStore } from "@/modules/settings.store";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useRemoteDrag } from "@/modules/remoteDrag";
import { useRemoteStatus } from "@/modules/remoteStatus";
import { useRemotePaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import { useStatusLabels } from "@/hooks/domain/metadata/useStatusLabels";
import type { PanePreviewBindings } from "@/hooks/ui/view/useQuickPreview";
import type { LinkedPane } from "@/lib/paneLink";
import type { ViewMode, SortState } from "@/types";
import { displayRemoteEntries } from "./remoteDirectory";
import { RemoteEntries } from "./RemoteEntries";
import { useRemoteListing } from "./useRemoteListing";
import { listenRemoteDirectoryChanges } from "./remoteChanges";
import { remoteScrollCache } from "./remoteViewCache";
import { hasVisibleShortcutOverlay, isRemotePaneActive, isRemotePaneShortcutFocus } from "./remotePaneKeyboard";
import "./remoteFolder.scss";

type Props = {
  preview: PanePreviewBindings;
  onPreviewRelease?: (path: string) => boolean;
  pane: LinkedPane;
  tabId: string;
  path: string;
  search: string;
  viewMode: ViewMode;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (path: string) => void;
  onOpenTab: (path: string) => void;
  hostId: string;
  refreshVersion?: number;
  sort: SortState;
  onSort: (sort: SortState) => void;
  scrollTop?: number;
  onScrollTop?: (top: number) => void;
};

export function RemoteFolderView(props: Props) {
  const { profile, connection, sessionId, data, error, refresh, reconnect } = useRemoteListing(props.hostId, props.path, props.refreshVersion);
  const transferLocation = useMemo(() => sessionId !== undefined && data ? ({
    kind: "remote" as const, profileId: props.hostId, sessionId, path: data.path, displayedPath: props.path, refresh,
  }) : undefined, [props.hostId, props.path, sessionId, data, refresh]);
  useRemotePaneDirectory(props.pane, transferLocation);
  const showHidden = useSettingsStore(s => s.remoteShowHidden);
  const entries = useMemo(() => data ? displayRemoteEntries(data.entries, props.sort, props.search, showHidden) : [], [data, props.sort, props.search, showHidden]);
  const connected = connection?.status === "connected";
  const scrollKey = JSON.stringify([props.tabId, props.hostId, sessionId, connection?.epoch, props.path, props.sort.key, props.sort.dir, props.viewMode]);
  useEffect(() => listenRemoteDirectoryChanges(change => {
    if (change.profileId === props.hostId && change.sessionId === sessionId && change.path === data?.path) refresh();
  }), [props.hostId, sessionId, data?.path, refresh]);
  useEffect(() => {
    const onRefresh = (event: globalThis.KeyboardEvent) => {
      if (useRemoteDrag.getState().preview) return;
      if (event.defaultPrevented || event.altKey || event.metaKey || event.shiftKey) return;
      if (!(event.key === "F5" || (event.ctrlKey && event.key.toLowerCase() === "r"))) return;
      if (!isRemotePaneActive(props.pane, useBottomPaneStore.getState().active)) return;
      const active = document.activeElement;
      if (!isRemotePaneShortcutFocus(props.pane, active, document) || hasVisibleShortcutOverlay(document)) return;
      if (!connected) return;
      event.preventDefault(); event.stopPropagation(); refresh();
    };
    window.addEventListener("keydown", onRefresh, true);
    return () => window.removeEventListener("keydown", onRefresh, true);
  }, [connected, props.pane, refresh]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const entryMeta = useMemo(() => new Map(entries.map(entry => [entry.path, entry])), [entries]);
  const visibleSelection = useMemo(() => new Set([...selected].filter(path => entryMeta.has(path))), [selected, entryMeta]);
  const total = data?.entries.length ?? 0;
  const { countLabel, selectionLabel } = useStatusLabels({ selected: visibleSelection, entryMeta,
    isFiltered: Boolean(props.search.trim()) || entries.length !== total, visibleCount: entries.length, totalCount: total });
  const failure = error || connection?.error;
  const message = failure || (!profile ? "Remote host unavailable" : connection?.status === "disconnected" ? "Disconnected"
    : !connected ? "Connecting…" : !data ? "Loading folder…" : "");
  useLayoutEffect(() => {
    useRemoteStatus.setState({ [props.pane]: { countLabel: data ? countLabel : "", selectionLabel, message,
      level: failure ? "error" : connected && !data ? "loading" : "idle" } });
    return () => useRemoteStatus.setState({ [props.pane]: null });
  }, [props.pane, data, countLabel, selectionLabel, message, failure, connected]);
  let content;
  if (!profile) content = <EmptyState title="Remote host unavailable" subtitle="This host is no longer saved." />;
  else if (connection?.status === "disconnected") content = <EmptyState title="Disconnected" subtitle={connection.error} actions={[{ label: "Reconnect", onClick: reconnect }]} />;
  else if (error) content = <EmptyState title="Couldn't open folder" subtitle={error} actions={[{ label: "Retry", onClick: refresh }]} />;
  else if (!data) content = <div className="remote-loading" role="status">{connected ? "Loading folder…" : "Connecting…"}</div>;
  else content = <RemoteEntries {...props} directoryPath={data.path} onSelection={setSelected} key={JSON.stringify([props.hostId, data.sessionId, connection?.epoch, props.path])} entries={entries} sessionId={data.sessionId} sessionEpoch={connection?.epoch ?? 0}
    scrollTop={remoteScrollCache.get(scrollKey) ?? props.scrollTop} onScrollTop={top => { remoteScrollCache.set(scrollKey, top, 1); props.onScrollTop?.(top); }} />;
  return <section className="remote-folder" aria-label={`Remote folder ${props.path}`}
    data-remote-host={props.hostId} data-remote-folder-path={data?.path ?? props.path}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }} onKeyDown={e => {
      if (useRemoteDrag.getState().preview) return;
      const input = e.target instanceof HTMLInputElement;
      if (!input && (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r"))) {
        e.preventDefault(); e.stopPropagation();
        if (connected) refresh();
      }
      if (!input && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === "ArrowLeft" && props.canBack) props.onBack();
        if (e.key === "ArrowRight" && props.canForward) props.onForward();
      }
    }}>

    <div className="remote-body">{content}</div>
    {data && data.omittedEntries > 0 && <p className="remote-omitted">{data.omittedEntries} {data.omittedEntries === 1 ? "name cannot" : "names cannot"} be displayed.</p>}
  </section>;
}
