// Mount the real remote views with disposable in-memory SFTP and clipboard replies.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PathCrumbsBar } from "@/components/explorer/PathCrumbsBar";
import { RemoteFolderView } from "@/components/remote/RemoteFolderView";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { useRemoteStatus } from "@/modules/remoteStatus";
import { usePromptStore } from "@/modules/promptStore";
import { useSettingsStore } from "@/modules/settings.store";
import { useRemoteEntryDrag } from "@/components/remote/useRemoteEntryDrag";
import { RemoteDragPreview } from "@/components/remote/RemoteDragPreview";
import { useRemoteDrag } from "@/modules/remoteDrag";
import { useFileDrop } from "@/hooks/domain/filesystem/useFileDrop";
import { getPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import { openRemoteTab } from "@/modules/remoteTabs";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { useTransferStore } from "@/modules/transferStore";
import { TransferStatusItemActions } from "@/components/transfer/TransferStatusItemActions";
import { DropTargetSubmenu } from "@/components/overlay/DropTargetSubmenu";
import { pasteIntoRemote, pasteRemoteClipboardToLocal } from "@/modules/remoteClipboard";
import { useClipboardStore } from "@/modules/clipboardStore";
import { exerciseRemotePlaces } from "./remotePlaces";

type Pane = "main" | "bottom";
const displayedPath = (pane: Pane) => pane === "main" ? "/alias/work" : "/bottom";
const reads: Record<Pane, number> = { main: 0, bottom: 0 };
const clipboard: string[] = [];
const releasedDropStages: number[] = [];
let finishUpload: (() => void) | undefined;
let sequence = 1;
let localCut: string[] = [];
let skipLast = false;
let replaceClipboardDuringMove = false;
const transfers: { command: string; args: any }[] = [];
const preflightEnds: { transferId: string; cancelled: boolean }[] = [];
const callbacks = new Map<number, (event: any) => void>();
const listeners = new Map<string, number>();
let nextCallback = 1;
let connectingHost: string | undefined;
let finishConnection: (() => void) | undefined;
let disconnects = 0;
const noop = () => {};
const preview = { registerSource: () => noop, onPress: () => false, open: noop };

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  transformCallback: (callback: (event: any) => void) => { const id = nextCallback++; callbacks.set(id, callback); return id; },
  invoke: async (command: string, args: any) => {
    if (command === "release_drop_stage") { releasedDropStages.push(args.id); return; }
    if (command === "remote_transfer_preflight_ended") { preflightEnds.push(args); return; }
    if (command === "remote_connect") {
      connectingHost = args.profileId;
      await new Promise<void>(resolve => { finishConnection = resolve; });
      connectingHost = undefined;
      return { path: "/", sessionId: 77 };
    }
    if (command === "remote_disconnect") { disconnects++; finishConnection?.(); return; }
    if (command === "remote_finish_interrupted_transfers") return { restored: [], warnings: [], deleteNoticeIds: [] };
    if (command === "remote_recovery_details") return [];
    if (command === "remote_list") {
      const pane = args.profileId as Pane;
      reads[pane]++;
      return { path: `/${pane}`, sessionId: args.sessionId, omittedEntries: 0,
        entries: ["alpha.txt", "beta.txt", "folder"].map(name => ({ name, path: `/${pane}/${name}`,
          isDir: name === "folder", isSymlink: false, size: 10, modified: 1 })) };
    }
    if (command === "remote_resolve_target" && args.path === "/alias") return { kind: "directory", path: "/archive" };
    if (command === "set_remote_clipboard") {
      if (args.expectedSequence !== undefined && args.expectedSequence !== sequence) return 0;
      clipboard.push(String(args.text)); localCut = []; sequence++;
      return args.text ? sequence : 0;
    }
    if (command === "get_file_clipboard") return { paths: localCut, mode: localCut.length ? "move" : "copy", sequence };
    if (command === "finish_file_cut") {
      if (args.sequence === sequence) { localCut = localCut.filter(path => !args.moved.includes(path)); sequence++; }
      return;
    }
    if (command === "plugin:event|listen") { listeners.set(args.event, args.handler); return args.handler; }
    if (command === "plugin:event|unlisten" || command === "file_drop_listener_ready") return undefined;
    if (command === "remote_transfer_file") {
      transfers.push({ command, args });
      if (replaceClipboardDuringMove) {
        replaceClipboardDuringMove = false;
        sequence++;
        localCut = ["C:\\newer-selection"];
      }
      return { items: args.request.entries.map((_: unknown, index: number) => ({ index, result: { path: "/moved" }, error: null })), cancelled: false };
    }
    if (command === "remote_transfer_batch") {
      if (args.dropStage === 33) throw new Error("Upload rejected before claiming the attachment");
      transfers.push({ command, args });
      if (args.dropStage === 31) await new Promise<void>(resolve => { finishUpload = resolve; });
      return { items: args.items.map((_: unknown, index: number) => skipLast && index === args.items.length - 1
        ? { index, result: null, skipped: true } : { index, result: { path: "/copied" }, error: null, skipped: false }), cancelled: false };
    }
    throw new Error(`Unexpected fixture command: ${command}`);
  },
};
(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: noop };
useRemoteHosts.setState({
  profiles: ["main", "bottom"].map(id => ({ id, name: id, destination: `${id}.example`, startPath: "" })),
  connections: { main: { status: "connected", sessionId: 1, epoch: 1, path: "/main" }, bottom: { status: "connected", sessionId: 2, epoch: 1, path: "/bottom" } },
});
useBottomPaneStore.setState({ open: true, active: false });
useSettingsStore.setState({ showParentEntry: false, remoteThumbnails: false, remoteVideoThumbnails: false });

function PaneView({ pane }: { pane: Pane }) {
  return <RemoteFolderView pane={pane} tabId={`${pane}-tab`} path={displayedPath(pane)} hostId={pane} search=""
    sort={{ key: "name", dir: "asc" }} viewMode="list" preview={preview} canBack={false} canForward={false}
    onBack={noop} onForward={noop} onNavigate={noop} onOpenTab={noop} onSort={noop} />;
}

function Crumbs({ pane }: { pane: Pane }) {
  const target = useRemoteDrag(state => state.remoteTarget?.kind === "remote-crumb" && state.remoteTarget.pane === pane
    ? state.remoteTarget.path : null);
  return <PathCrumbsBar pane={pane} remoteHost={pane} remoteProfileId={pane} dropTargetPath={target}
    path={displayedPath(pane)} onNavigate={noop} />;
}

function DragDriver() {
  const entries = useMemo(() => new Map([["/main/alpha.txt", {
    name: "alpha.txt", path: "/main/alpha.txt", isDir: false, isSymlink: false, size: 10, modified: 1,
  }]]), []);
  const start = useRemoteEntryDrag("main", "main", 1, "/main", entries);
  useEffect(() => {
    (window as any).startFixtureDrag = (paths = ["/main/alpha.txt"]) => start(paths, undefined,
      { x: 2, y: 2, ctrlKey: false, shiftKey: false, altKey: false });
    return () => { delete (window as any).startFixtureDrag; };
  }, [start]);
  return null;
}

function Fixture() {
  const preflights = useTransferStore(state => state.localJobs);
  const [fullWidth, setFullWidth] = useState(false);
  const drop = useFileDrop({ beginFileActivity: () => noop, currentPath: "", enabled: true, enableTabDropParentFolder: true, enableTabDropSubfolders: true });
  const crumbs = <Crumbs pane="main" />;
  return <div data-layout={fullWidth ? "full" : "default"}>
    <div className="topstack" onFocusCapture={() => setBottomPaneActive(false)}>
      <input id="main-input" aria-label="Main path" />
      {fullWidth && crumbs}
    </div>
    {!fullWidth && <div className="main-crumbs" onFocusCapture={() => setBottomPaneActive(false)}>{crumbs}</div>}
    <main data-file-pane="main" data-pane-path="" data-remote-pane="true" onFocusCapture={() => setBottomPaneActive(false)}><PaneView pane="main" /></main>
    <section className="bottom-pane" onFocusCapture={() => setBottomPaneActive(true)}>
      <input id="bottom-input" aria-label="Bottom path" />
      <Crumbs pane="bottom" />
      <div data-file-pane="bottom" data-pane-path="" data-remote-pane="true"><PaneView pane="bottom" /></div>
    </section>
    <button id="outside">Outside pane</button>
    <button id="sidebar-place" data-is-dir="true" data-path={"C:\\Downloads"}
      data-drop-target={drop.dropTargetPath === "C:\\Downloads" ? "true" : "false"}>Downloads</button>
    <button id="toggle-layout" onClick={() => setFullWidth(value => !value)}>Change layout</button>
    <DragDriver />
    <RemoteDragPreview />
    <DropTargetSubmenu open={!!drop.tabDropSubmenu.hostTabId} anchorElement={document.getElementById("fixture-drop-tab")}
      {...drop.tabDropSubmenu} dragPoint={drop.dragPoint} activePath={drop.dropTargetPath} />
    {preflights.map(job => <div key={job.id} data-preflight={job.id}>
      <TransferStatusItemActions job={job} onOpenDestination={noop} />
    </div>)}
  </div>;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function waitFor(condition: () => unknown, message: string) {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => window.setTimeout(resolve, 20));
  }
}
function press(target: Element, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
function crumb(pane: Pane) {
  const button = document.querySelector<HTMLButtonElement>(`[data-breadcrumb-pane="${pane}"] .crumb`);
  check(button, `Missing ${pane} breadcrumb`);
  button.focus();
  check(document.activeElement === button, `${pane} breadcrumb did not receive focus`);
  return button;
}
const selected = (pane: Pane) => useRemoteStatus.getState()[pane]?.selectionLabel ?? "";

function point(element: Element) {
  const box = element.getBoundingClientRect();
  check(box.width && box.height, "Drop target is not visible");
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
function dragPointer(type: "pointermove" | "pointerup", at: { x: number; y: number }, modifiers: PointerEventInit = {}) {
  window.dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y, buttons: type === "pointermove" ? 1 : 0, ...modifiers }));
}
function startDrag() {
  check(typeof (window as any).startFixtureDrag === "function", "Remote drag driver did not mount");
  (window as any).startFixtureDrag();
}
function crumbTarget(pane: Pane, path: string) {
  const target = document.querySelector<HTMLButtonElement>(`[data-breadcrumb-pane="${pane}"] .crumb[data-remote-crumb-path="${path}"]`);
  check(target, `Missing ${pane} drop breadcrumb ${path}`);
  return target;
}

async function exerciseDrops(layout: string) {
  let mainCrumb = crumb("main");
  check(press(mainCrumb, "a", { ctrlKey: true }).defaultPrevented, `${layout}: select all before drag failed`);
  await waitFor(() => selected("main").startsWith("3 selected"), `${layout}: selection before drag missing`);
  (window as any).startFixtureDrag(["/", "/main/alpha.txt"]);
  dragPointer("pointermove", point(crumbTarget("main", "/")));
  check(useRemoteDrag.getState().preview?.count === 1, `${layout}: parent row entered the drag`);
  check(press(mainCrumb, "Escape").defaultPrevented, `${layout}: Escape did not cancel the drag`);
  await waitFor(() => !useRemoteDrag.getState().preview, `${layout}: Escape left the drag preview visible`);
  check(selected("main").startsWith("3 selected"), `${layout}: cancelling the drag cleared the selection`);
  mainCrumb = crumb("main");
  press(mainCrumb, "Escape");
  await waitFor(() => !selected("main"), `${layout}: selection remained after cancelling the drag`);

  (window as any).startFixtureDrag(["/main/missing"]);
  check(!useRemoteDrag.getState().preview && usePromptStore.getState().prompt?.title === "Drag unavailable", `${layout}: stale drag selection was accepted`);
  usePromptStore.getState().hidePrompt();

  for (const pane of ["main", "bottom"] as const) {
    const target = crumbTarget(pane, "/");
    const at = point(target);
    startDrag();
    dragPointer("pointermove", at);
    await waitFor(() => useRemoteDrag.getState().remoteTarget?.kind === "remote-crumb", `${layout} ${pane}: breadcrumb did not accept a remote drag`);
    check(useRemoteDrag.getState().preview?.action === "move", `${layout} ${pane}: move preview missing`);
    await waitFor(() => target.dataset.dropTarget === "true", `${layout} ${pane}: breadcrumb highlight missing`);
    await waitFor(() => document.querySelector('.remote-drag-preview-action[data-action="move"]'), `${layout} ${pane}: drag preview missing`);
    const count = transfers.length;
    dragPointer("pointerup", at);
    await waitFor(() => transfers.length === count + 1, `${layout} ${pane}: remote drop was not submitted`);
    const sent = transfers[count];
    if (pane === "main") {
      check(sent.command === "remote_transfer_file" && sent.args.request.destination === "/", `${layout}: same-host move used the wrong destination`);
    } else {
      check(sent.command === "remote_transfer_batch" && sent.args.moving === true &&
        sent.args.items[0].request.destProfile === "bottom" && sent.args.items[0].request.remoteFolder === "/", `${layout}: cross-host move used the wrong destination`);
    }
    await waitFor(() => !useRemoteDrag.getState().preview, `${layout} ${pane}: drag preview remained after drop`);

    startDrag();
    dragPointer("pointermove", at, { ctrlKey: true });
    await waitFor(() => useRemoteDrag.getState().preview?.action === "copy", `${layout} ${pane}: copy preview missing`);
    const copies = transfers.length;
    dragPointer("pointerup", at, { ctrlKey: true });
    await waitFor(() => transfers.length === copies + 1, `${layout} ${pane}: copy was not submitted`);
    check(transfers[copies].command === "remote_transfer_batch" && !transfers[copies].args.moving &&
      transfers[copies].args.items[0].request.remoteFolder === "/", `${layout} ${pane}: copy used the wrong destination`);
  }

  const current = crumbTarget("main", "/main");
  startDrag();
  dragPointer("pointermove", point(current));
  check(useRemoteDrag.getState().preview?.action === "unavailable", `${layout}: current folder was accepted`);
  dragPointer("pointerup", point(current));
  check(!useRemoteDrag.getState().preview, `${layout}: invalid drop did not clear the preview`);

  const root = crumbTarget("main", "/");
  startDrag();
  dragPointer("pointermove", point(root), { altKey: true });
  check(useRemoteDrag.getState().preview?.action === "unavailable", `${layout}: Alt advertised an unsupported action`);
  dragPointer("pointerup", point(root), { altKey: true });

  const folder = document.querySelector('[data-file-pane="main"] [data-remote-path="/main/folder"]');
  check(folder, `${layout}: remote folder row missing`);
  startDrag();
  dragPointer("pointermove", point(folder));
  check(useRemoteDrag.getState().remoteTarget?.kind === "remote-entry", `${layout}: folder row did not accept the drag`);
  const folderCount = transfers.length;
  dragPointer("pointerup", point(folder));
  await waitFor(() => transfers.length === folderCount + 1, `${layout}: folder move was not submitted`);
  check(transfers[folderCount].args.request.destination === "/main/folder", `${layout}: folder move targeted the wrong path`);

  const sidebar = document.getElementById("sidebar-place")!;
  startDrag();
  dragPointer("pointermove", point(sidebar), { shiftKey: true });
  check(useRemoteDrag.getState().preview?.action === "move", `${layout}: sidebar move preview missing`);
  await waitFor(() => sidebar.dataset.dropTarget === "true", `${layout}: sidebar highlight missing`);
  const sidebarCount = transfers.length;
  dragPointer("pointerup", point(sidebar), { shiftKey: true });
  await waitFor(() => transfers.length === sidebarCount + 1, `${layout}: sidebar drop was not submitted`);
  check(transfers[sidebarCount].args.items[0].request.localFolder === "C:\\Downloads" && transfers[sidebarCount].args.moving,
    `${layout}: sidebar drop used the wrong action or destination`);

  await waitFor(() => listeners.has("stratum-file-drag"), `${layout}: native drop listener missing`);
  const listener = callbacks.get(listeners.get("stratum-file-drag")!)!;
  for (const pane of ["main", "bottom"] as const) {
    const target = crumbTarget(pane, "/");
    const at = point(target);
    const position = { x: at.x * window.devicePixelRatio, y: at.y * window.devicePixelRatio };
    listener({ payload: { type: "over", position } });
    await waitFor(() => target.dataset.dropTarget === "true", `${layout} ${pane}: native drag highlight missing`);
    const count = transfers.length;
    listener({ payload: { type: "drop", position, paths: ["C:\\Temp\\local.txt"], mode: "copy", stage: null } });
    await waitFor(() => transfers.length === count + 1, `${layout} ${pane}: native upload was not submitted`);
    check(transfers[count].args.items[0].request.kind === "upload" &&
      transfers[count].args.items[0].request.remoteFolder === "/" && transfers[count].args.profileId === pane,
    `${layout} ${pane}: native upload used the wrong destination`);
    await waitFor(() => target.dataset.dropTarget === "false", `${layout} ${pane}: native drag highlight remained`);
  }
}

async function exerciseAliasAndPendingDrop() {
  const alias = crumbTarget("main", "/archive");
  check(alias.textContent === "alias", "Breadcrumb lost its displayed name");
  startDrag();
  dragPointer("pointermove", point(alias));
  check(useRemoteDrag.getState().preview?.action === "move", "Alias did not advertise a move");
  const before = transfers.length;
  dragPointer("pointerup", point(alias));
  await waitFor(() => transfers.length === before + 1, "Alias move was not submitted");
  check(transfers[before].args.request.destination === "/archive", "Move used the displayed alias");

  const listener = callbacks.get(listeners.get("stratum-file-drag")!)!;
  const at = point(alias);
  const position = { x: at.x * devicePixelRatio, y: at.y * devicePixelRatio };
  const receive = (pendingDrop: number) => listener({ payload: { type: "receiving", pendingDrop, position } });
  const finish = (pendingDrop: number) => listener({ payload: { type: "drop", pendingDrop, position,
    paths: ["C:\\Temp\\local.txt"], mode: "copy", stage: 30 + pendingDrop } });
  const original = getPaneDirectory("main");
  check(original?.kind === "remote", "Missing remote destination");
  receive(1);
  original.refresh();
  await waitFor(() => getPaneDirectory("main")?.kind === "remote" && getPaneDirectory("main") !== original, "Listing did not refresh");
  finish(1);
  await waitFor(() => transfers.length === before + 2, "Refresh lost the pending drop");
  check(transfers[before + 1].args.items[0].request.remoteFolder === "/archive", "Upload lost its resolved destination");

  check(transfers[before + 1].args.dropStage === 31 && !transfers[before + 1].args.moving, "Attachment upload did not claim its stage for copying");
  check(!releasedDropStages.includes(31), "Temporary files were released during upload");
  finishUpload!();
  await waitFor(() => releasedDropStages.includes(31), "Temporary files were not released after upload");

  await waitFor(() => alias.dataset.remoteCrumbPath === "/archive", "Alias did not resolve after refresh");
  receive(3);
  finish(3);
  await waitFor(() => usePromptStore.getState().prompt?.title === "Copy completed with issues", "Rejected upload did not report the error");
  await waitFor(() => releasedDropStages.includes(33), "An open error notice held the temporary file");
  const failure = usePromptStore.getState().prompt!;
  usePromptStore.getState().hidePrompt(failure);
  failure.onConfirm?.();
  receive(2);
  useRemoteHosts.setState(state => ({ connections: { ...state.connections, main: { status: "connected", epoch: 2, sessionId: 3, path: "/main" } } }));
  await waitFor(() => {
    const directory = getPaneDirectory("main");
    return directory?.kind === "remote" && directory.sessionId === 3;
  }, "Destination did not reconnect");
  finish(2);
  await waitFor(() => usePromptStore.getState().prompt?.title === "Drop failed", "Changed session did not report a failed drop");
  check(transfers.length === before + 2, "Drop was sent to a replacement session");
  await waitFor(() => releasedDropStages.includes(32), "Rejected attachment drop leaked its stage");
  usePromptStore.getState().hidePrompt();
}

async function exerciseCutPaste() {
  const src = crumb("main");
  press(src, "a", { ctrlKey: true });
  await waitFor(() => selected("main").startsWith("3 selected"), "No range to cut");
  press(src, "x", { ctrlKey: true });
  await waitFor(() => useClipboardStore.getState().remote?.mode === "move", "Ctrl+X did not cut remote entries");
  skipLast = true;
  await pasteRemoteClipboardToLocal("C:\\Downloads");
  check(transfers.at(-1)?.args.moving && transfers.at(-1)?.args.items[0].request.kind === "download", "Cut download became a copy");
  check(useClipboardStore.getState().remote?.entries.length === 1, "Skipped remote cut was lost");
  skipLast = false;
  press(crumb("bottom"), "v", { ctrlKey: true });
  await waitFor(() => !useClipboardStore.getState().remote, "Completed remote cut was not consumed");
  check(transfers.at(-1)?.args.moving && transfers.at(-1)?.args.items[0].request.destProfile === "bottom", "Cross-host paste missed its destination");
  localCut = ["C:\\Temp\\one", "C:\\Temp\\two"];
  sequence++;
  skipLast = true;
  press(crumb("bottom"), "v", { ctrlKey: true });
  await waitFor(() => localCut.length === 1, "Local cut was not reconciled");
  check(localCut[0].endsWith("two") && transfers.at(-1)?.args.moving && transfers.at(-1)?.args.items[0].request.kind === "upload", "Wrong source consumed on partial upload");
  skipLast = false;
  press(crumb("main"), "x", { ctrlKey: true });
  await waitFor(() => useClipboardStore.getState().remote?.mode === "move", "Could not cut again");
  const writes = clipboard.length;
  replaceClipboardDuringMove = true;
  await pasteIntoRemote({ profileId: "main", sessionId: 1, path: "/archive" });
  check(transfers.at(-1)?.args.request.kind === "rename" && transfers.at(-1)?.args.request.destination === "/archive", "Same-host cut did not use a rename");
  check(clipboard.length === writes && localCut[0] === "C:\\newer-selection", "Finishing a cut replaced newer clipboard data");
  press(crumb("main"), "Escape");
}

async function exerciseRemoteTabMenu() {
  // Edge's dump-dom virtual clock advances timers without producing paint frames.
  // Drive the submenu's two positioning frames on that same clock.
  const { requestAnimationFrame, cancelAnimationFrame } = window;
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  openRemoteTab("bottom", "/bottom", "bottom");
  const anchor = document.createElement("button");
  anchor.id = "fixture-drop-tab";
  Object.assign(anchor.dataset, { dropKind: "remote-tab", dropProfile: "bottom", dropPath: "/bottom",
    dropId: getPaneSessionStore("bottom").getState().activeTabId });
  anchor.style.cssText = "position:fixed;top:10px;right:100px;width:100px;height:30px";
  document.body.append(anchor);
  const native = callbacks.get(listeners.get("stratum-file-drag")!)!;
  const position = (el: Element) => { const p = point(el); return { x: p.x * devicePixelRatio, y: p.y * devicePixelRatio }; };
  const row = (path: string) => document.querySelector<HTMLElement>(`.drop-submenu-item[data-drop-path="${path}"]`);
  native({ payload: { type: "over", position: position(anchor) } });
  await waitFor(() => row("/"), "Remote parent row did not load");
  await waitFor(() => row("/")?.closest<HTMLElement>(".drop-submenu-surface")?.style.visibility === "visible", "Remote parent menu did not become visible");
  const before = transfers.length;
  native({ payload: { type: "drop", paths: ["C:\\Temp\\file"], mode: "copy", stage: 40, position: position(row("/")!) } });
  await waitFor(() => transfers.length === before + 1, "Parent upload was not submitted");
  check(transfers[before].args.items[0].request.remoteFolder === "/", "Parent upload used the tab folder");
  check(transfers[before].args.dropStage === 40, "Remote submenu did not upload staged attachments");
  startDrag();
  dragPointer("pointermove", point(anchor));
  await waitFor(() => row("/bottom/folder")?.closest<HTMLElement>(".drop-submenu-surface")?.style.visibility === "visible", "Remote drag did not open subfolders");
  dragPointer("pointerup", point(row("/bottom/folder")!));
  await waitFor(() => transfers.length === before + 2, "Subfolder move was not submitted");
  check(transfers[before + 1].args.moving && transfers[before + 1].args.items[0].request.remoteFolder === "/bottom/folder", "Subfolder move used the wrong destination");
  anchor.remove();
  Object.assign(window, { requestAnimationFrame, cancelAnimationFrame });
}

async function exerciseConnectingDrop() {
  const profile = { id: "offline", name: "Offline host", destination: "offline.example", startPath: "/" };
  useRemoteHosts.setState(state => ({ profiles: [...state.profiles, profile] }));
  openRemoteTab(profile.id, "/", "bottom");
  const tab = document.createElement("button");
  Object.assign(tab.dataset, { dropKind: "remote-tab", dropProfile: profile.id, dropPath: "/",
    dropId: getPaneSessionStore("bottom").getState().activeTabId });
  tab.style.cssText = "position:fixed;top:2px;right:2px;width:80px;height:25px;z-index:1000";
  document.body.append(tab);
  const position = point(tab);
  const drop = () => { startDrag(); dragPointer("pointerup", position, { ctrlKey: true }); };
  const native = callbacks.get(listeners.get("stratum-file-drag")!)!;
  const attachment = (stage: number) => native({ payload: { type: "drop", stage, paths: ["C:\\Temp\\mail.pdf"], mode: "copy",
    position: { x: position.x * devicePixelRatio, y: position.y * devicePixelRatio } } });
  const before = transfers.length;
  drop();
  await waitFor(() => finishConnection, "Drop did not initiate SSH");
  attachment(41);
  await waitFor(() => document.querySelectorAll('[data-preflight] [aria-label="Cancel operation"]').length === 2, "Connecting drops have no Work controls");
  const [first, second] = useTransferStore.getState().localJobs;
  document.querySelector<HTMLButtonElement>(`[data-preflight="${first.id}"] button`)!.click();
  await waitFor(() => useTransferStore.getState().localJobs[0]?.status === "cancelled", "Work did not cancel the connecting drop");
  check(!disconnects && transfers.length === before, "Cancelled a shared SSH session or submitted early");
  check(!releasedDropStages.includes(41), "Attachment was released while connecting");
  finishConnection!();
  await waitFor(() => transfers.length === before + 1, "The other drop did not resume");
  check(transfers[before].args.dropStage === 41, "Connected tab upload lost its attachments");
  check(transfers[before].args.transferId === second.id, "Work lost its job ID after connecting");
  check(preflightEnds.filter(end => end.transferId === first.id && end.cancelled).length === 1, "Cancelled connection must report its Work ID once");
  check(!preflightEnds.some(end => end.transferId === second.id), "A successful handoff ended the transfer before the worker could report it");
  useRemoteHosts.setState(state => ({ connections: {
    ...state.connections, offline: { status: "disconnected", epoch: 2 },
  } }));
  finishConnection = undefined;
  attachment(42);
  await waitFor(() => finishConnection, "Second SSH attempt did not start");
  await waitFor(() => document.querySelector('[data-preflight] [aria-label="Cancel operation"]'), "Missing sole-waiter cancellation");
  document.querySelector<HTMLButtonElement>('[data-preflight] [aria-label="Cancel operation"]')!.click();
  await waitFor(() => disconnects > 0 && useRemoteHosts.getState().connections.offline?.status === "disconnected", "Last cancelled drop left SSH connecting");
  check(transfers.length === before + 1, "A cancelled handshake submitted a drop");
  await waitFor(() => releasedDropStages.includes(42), "Cancelling the connection leaked the attachment stage");
  tab.remove();
}

async function exercise(pane: Pane, layout: string) {
  const other = pane === "main" ? "bottom" : "main";
  let button = crumb(pane);
  const before = { ...reads };
  check(press(button, "F5").defaultPrevented, `${layout} ${pane}: F5 was not handled`);
  await waitFor(() => reads[pane] === before[pane] + 1, `${layout} ${pane}: F5 did not refresh`);
  check(reads[other] === before[other], `${layout} ${pane}: F5 refreshed the wrong pane`);

  check(press(button, "a", { ctrlKey: true }).defaultPrevented, `${layout} ${pane}: select all was not handled`);
  await waitFor(() => selected(pane).startsWith("3 selected"), `${layout} ${pane}: select all failed`);
  check(!selected(other), `${layout} ${pane}: select all changed the other pane`);
  const copied = clipboard.length;
  check(press(button, "c", { ctrlKey: true }).defaultPrevented, `${layout} ${pane}: copy was not handled`);
  await waitFor(() => clipboard.length === copied + 1, `${layout} ${pane}: copy did not reach the clipboard`);
  check(clipboard[copied].includes(`${pane}.example:/${pane}/alpha.txt`) && clipboard[copied].includes("beta.txt"),
    `${layout} ${pane}: copy used the wrong selection`);
  check(press(button, "Escape").defaultPrevented, `${layout} ${pane}: clear selection was not handled`);
  await waitFor(() => !selected(pane), `${layout} ${pane}: selection was not cleared`);

  button = crumb(pane);
  check(press(button, "b").defaultPrevented, `${layout} ${pane}: typeahead was not handled`);
  await waitFor(() => selected(pane).startsWith("1 selected"), `${layout} ${pane}: typeahead did not select`);
  button = crumb(pane);
  check(press(button, "Delete").defaultPrevented, `${layout} ${pane}: delete was not handled`);
  check(usePromptStore.getState().prompt?.title === "Delete permanently?", `${layout} ${pane}: delete prompt missing`);
  usePromptStore.getState().hidePrompt();
  check(press(button, "F2").defaultPrevented, `${layout} ${pane}: rename was not handled`);
  const paneSelector = `[data-file-pane="${pane}"]`;
  await waitFor(() => document.querySelector(`${paneSelector} .rename-input`), `${layout} ${pane}: rename input missing`);
  const renameInput = document.querySelector<HTMLInputElement>(`${paneSelector} .rename-input`)!;
  press(renameInput, "Escape");
  await waitFor(() => !document.querySelector(`${paneSelector} .rename-input`), `${layout} ${pane}: rename did not cancel`);
  button = crumb(pane);
  check(press(button, "Escape").defaultPrevented, `${layout} ${pane}: final clear was not handled`);
  await waitFor(() => !selected(pane), `${layout} ${pane}: final selection remained`);
}

async function run() {
  createRoot(document.getElementById("root")!).render(<Fixture />);
  await waitFor(() => document.querySelectorAll(".remote-entries").length === 2, "Remote entries did not mount");
  await waitFor(() => useRemoteStatus.getState().main?.countLabel && useRemoteStatus.getState().bottom?.countLabel,
    "Remote listings did not load");
  for (const layout of ["default", "full"]) {
    for (const pane of ["main", "bottom"] as const) await exercise(pane, layout);
    await exerciseDrops(layout);
    if (layout === "default") {
      document.getElementById("toggle-layout")!.click();
      await waitFor(() => document.querySelector('[data-layout="full"]'), "Full-width layout did not render");
    }
  }
  await exerciseCutPaste();
  await exerciseRemoteTabMenu();
  await exerciseConnectingDrop();
  await exerciseAliasAndPendingDrop();
  for (const pane of ["main", "bottom"] as const) {
    const input = document.getElementById(`${pane}-input`) as HTMLInputElement;
    input.focus();
    check(!press(input, "a", { ctrlKey: true }).defaultPrevented, `${pane}: input selection was intercepted`);
    check(!selected(pane), `${pane}: input selection changed remote selection`);
    const button = crumb(pane);
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText = "position:fixed;width:20px;height:20px";
    document.body.append(overlay);
    check(!press(button, "F5").defaultPrevented, `${pane}: F5 bypassed a dialog`);
    check(!press(button, "a", { ctrlKey: true }).defaultPrevented, `${pane}: select all bypassed a dialog`);
    overlay.remove();
  }
  const outside = document.getElementById("outside") as HTMLButtonElement;
  outside.focus();
  check(!press(outside, "F5").defaultPrevented, "F5 was intercepted outside the panes");
  check(!press(outside, "a", { ctrlKey: true }).defaultPrevented, "Select all was intercepted outside the panes");
  outside.blur();
  check(document.activeElement === document.body, "Focus did not return to the document");
  setBottomPaneActive(false);
  check(press(document.body, "a", { ctrlKey: true }).defaultPrevented, "Document focus did not select in the active pane");
  await waitFor(() => selected("main").startsWith("3 selected"), "Document focus selected the wrong pane");
  check(!selected("bottom"), "Document focus changed the inactive pane");
  press(document.body, "Escape");
  await waitFor(() => !selected("main"), "Document focus did not clear the selection");
  await exerciseRemotePlaces(waitFor, async () => {
    await waitFor(() => connectingHost === "main", "Pin did not start SSH for the saved host");
    finishConnection!();
  });
}

run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});
