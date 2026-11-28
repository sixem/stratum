// Drive the actual picker, properties dialog and pane shortcuts against two distinct SFTP hosts.
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { QuickMoveOverlay } from "@/components/app/QuickMoveOverlay";
import { PromptModal } from "@/components/overlay/PromptModal";
import { RemoteFolderView } from "@/components/remote/RemoteFolderView";
import { openQuickMove } from "@/modules/quickMoveSession";
import { openRemoteTab, updateRemoteTab } from "@/modules/remoteTabs";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";
import { toggleQuickMoveFavorite } from "@/modules/quickMoveStore";
import "@/styles/app.scss";

const noop = () => {};
const next = () => new Promise(resolve => setTimeout(resolve, 20));
async function wait(condition: () => unknown, message: string) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await next(); }
  throw Error(message);
}
function check(value: unknown, message: string) { if (!value) throw Error(message); }
const preview = { registerSource: () => noop, onPress: () => false, open: noop };
const profiles = ["main", "bottom", "offline"].map(id => ({ id, name: "Archive", destination: id + ".example", startPath: "" }));
const transfers: { command: string; args: any }[] = [];
let finishCheck: (() => void) | undefined;
let delayCheck = false;
const row = (host: string, path: string) => [...document.querySelectorAll<HTMLButtonElement>(".quick-move-destination")].find(el =>
  el.querySelector(".quick-move-host")?.textContent === host + ".example" && el.querySelector(".quick-move-path > :last-child")?.textContent === path);
const key = (el: HTMLElement, name: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));

async function run() {
  const panes = ["main", "bottom"] as const;
  useSettingsStore.setState({ indexedSearchEnabled: false, showParentEntry: false, remoteThumbnails: false });
  useRemoteHosts.setState({ profiles, connections: { main: { status: "connected", epoch: 1, sessionId: 11, path: "/shared" },
    bottom: { status: "connected", epoch: 1, sessionId: 22, path: "/shared" } } });
  mockIPC(async (command, args: any) => {
    if (command === "get_indexed_search_status") return { state: "ready", catalogRevision: 1 };
    if (command === "list_indexed_drive_statuses") return [{ drivePath: "C:\\", searchable: true }];
    if (command === "quick_move_destination_exists") return args.path === "C:\\incoming";
    if (command === "remote_list") return { path: args.path, sessionId: args.sessionId, omittedEntries: 0,
      entries: [{ name: "report", path: args.path + "/report", isDir: false, isSymlink: false, modified: 0, size: 0 }] };
    if (command === "remote_properties") {
      check(args.path === "/shared/report" && args.sessionId === (args.profileId === "main" ? 11 : 22), "Properties lost the selected entry or session");
      return args.profileId === "main" ? { size: "9007199254740993", modified: null, permissions: 0o4750, isSymlink: true, linkTarget: "../old target" } :
        { size: "0", modified: 0, permissions: 0, isSymlink: false, linkTarget: null };
    }
    if (command === "remote_resolve_target") {
      if (delayCheck) await new Promise<void>(resolve => { finishCheck = resolve; });
      return { kind: "directory", path: args.path === "/visited" ? "/canonical" : args.path };
    }
    if (command === "remote_transfer_batch" || command === "remote_transfer_file") {
      transfers.push({ command, args });
      return { items: [{ index: 0, result: { path: "/moved" } }], cancelled: false };
    }
    return [];
  }, { shouldMockEvents: true });
  openRemoteTab("offline", "/hidden", "main");
  for (const pane of panes) {
    openRemoteTab(pane, "/shared", pane);
    const session = getPaneSessionStore(pane).getState();
    updateRemoteTab(pane, session.activeTabId!, tab => ({ ...tab, remoteHistory: { back: ["/visited"], forward: [] } }));
  }
  const upper = getPaneSessionStore("main").getState();
  const tab = upper.tabs.find(item => item.id === upper.activeTabId);
  if (tab?.kind === "remote") upper.updateSession({ closedTabs: [{ index: 0, tab: { ...tab, id: "closed",
    remote: { ...tab.remote, path: "/recently closed" } } }] });
  createRoot(document.getElementById("root")!).render(<>{panes.map(pane =>
    <section key={pane} data-file-pane={pane} style={{ display: "flex", width: 540, height: 150 }}>
      <RemoteFolderView pane={pane} tabId={pane} hostId={pane} path="/shared" sort={{ key: "name", dir: "asc" }} search=""
        viewMode="list" canBack={false} canForward={false} onBack={noop} onForward={noop} onNavigate={noop}
        onOpenTab={noop} onSort={noop} preview={preview} />
    </section>)}<QuickMoveOverlay/><PromptModal/></>);
  for (const pane of panes) {
    const entries = () => document.querySelector<HTMLElement>(`[data-file-pane="${pane}"] .remote-entries`)!;
    await wait(() => entries()?.querySelector('[data-remote-path="/shared/report"]'), "Missing remote row");
    if (pane === "main") {
      entries().querySelector('[data-remote-path="/shared/report"]')!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 2 }));
      const properties = () => [...document.querySelectorAll<HTMLButtonElement>(".context-item")].find(el => el.textContent === "Properties");
      await wait(properties, "No properties action"); properties()!.click();
    } else {
      entries().focus(); key(entries(), "Home"); await next(); key(entries(), "Enter", { altKey: true });
    }
    await wait(() => document.querySelector(".remote-mode"), "Properties did not load");
    const content = document.querySelector(".remote-properties")!.textContent!;
    check(content.includes(pane + ".example") && content.includes("/shared/report") &&
      (pane === "main" ? content.includes("rwsr-x--- (4750)") && content.includes("../old target") && content.includes("Unavailable") && content.includes(9007199254740993n.toLocaleString()) :
        content.includes("0 B") && content.includes("--------- (0000)") && !content.includes("Link target")), "Incorrect properties: " + content);
    document.querySelector<HTMLButtonElement>(".prompt-actions button")!.click(); await next();
  }
  const local = () => openQuickMove(["C:\\work\\report"], () => { throw Error("A remote path reached a local move"); });
  check(local(), "Quick Move required a local index");
  await wait(() => row("main", "/shared") && row("bottom", "/shared") && row("main", "/visited"), "Picker omitted an open or recent host folder");
  check(!row("offline", "/hidden"), "Disconnected host appeared");
  const search = document.querySelector<HTMLInputElement>(".quick-move-input")!;
  const query = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  };
  query("main.example");
  await wait(() => row("main", "/recently closed") && !row("bottom", "/shared"), "Host search lost history or retained a different host");
  query("");
  await wait(() => row("bottom", "/visited"), "Clearing the search did not restore other hosts");
  row("main", "/visited")!.click();
  await wait(() => transfers.length === 1, "Upload move did not start");
  const upload = transfers[0].args;
  check(upload.profileId === "main" && upload.moving && upload.items[0].request.remoteFolder === "/canonical", "Upload lost its destination");
  const lower = document.querySelector<HTMLElement>('[data-file-pane="bottom"] .remote-entries')!;
  lower.focus(); key(lower, "Home"); await next(); key(lower, "m", { ctrlKey: true, shiftKey: true });
  await wait(() => row("bottom", "/shared"), "Remote Quick Move shortcut did not open");
  check(row("bottom", "/shared")!.disabled && !row("main", "/shared")!.disabled, "Same-path folders on different hosts were conflated");
  row("main", "/shared")!.click();
  await wait(() => transfers.length === 2, "Cross-host move did not start");
  const cross = transfers[1].args;
  check(cross.moving && cross.profileId === "bottom" && cross.items[0].request.destProfile === "main" &&
    cross.items[0].expected.name === "report", "Cross-host move lost its source identity");
  lower.focus(); key(lower, "m", { ctrlKey: true, shiftKey: true });
  await wait(() => row("bottom", "/visited"), "Missing same-host history");
  row("bottom", "/visited")!.click();
  await wait(() => transfers.length === 3, "Same-host move did not start");
  check(transfers[2].args.request.kind === "rename" && transfers[2].args.request.destination === "/canonical", "Same-host move lost its canonical folder");
  check(local(), "Could not reopen picker");
  await wait(() => row("main", "/shared"), "Missing stale-session test row");
  delayCheck = true; row("main", "/shared")!.click();
  await wait(() => finishCheck, "Destination validation did not start");
  useRemoteHosts.setState(state => ({ connections: { ...state.connections, main: { status: "disconnected", epoch: 2 } } }));
  finishCheck!();
  await wait(() => document.querySelector(".quick-move-error") && !row("main", "/shared"), "Disconnect did not invalidate the pending move");
  check(transfers.length === 3, "Disconnected destination received a move");
  key(document.querySelector<HTMLInputElement>(".quick-move-input")!, "Escape");
  await wait(() => !document.querySelector(".quick-move-panel"), "Picker did not close");
  useSettingsStore.setState({ indexedSearchEnabled: true });
  toggleQuickMoveFavorite(null, "C:\\incoming");
  lower.focus(); key(lower, "m", { ctrlKey: true, shiftKey: true });
  const localRow = () => [...document.querySelectorAll<HTMLButtonElement>(".quick-move-destination")].find(el =>
    el.querySelector(".quick-move-path")?.textContent === "C:\\incoming");
  await wait(localRow, "Indexed local folder was unavailable to a remote selection"); localRow()!.click();
  await wait(() => transfers.length === 4, "Quick Move did not download the remote selection");
  const download = transfers[3].args;
  check(download.profileId === "bottom" && download.moving && download.items[0].request.localFolder === "C:\\incoming", "Remote move used the wrong local destination");
}

run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});
