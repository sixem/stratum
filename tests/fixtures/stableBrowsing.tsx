// Run the production local and SFTP renderers side by side against repeatable directory snapshots.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { FileView } from "@/components/explorer/FileView";
import { RemoteFolderView } from "@/components/remote/RemoteFolderView";
import { TransferStatusButton } from "@/components/transfer/TransferStatusButton";
import { PromptModal } from "@/components/overlay/PromptModal";
import { buildEntryItems } from "@/lib/entryItems";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { checkInterruptedOperations, type RecoveryDetail } from "@/modules/remoteRecovery";
import { useSettingsStore } from "@/modules/settings.store";
import type { FileEntry, SortState, ViewMode } from "@/types";
import "@/styles/app.scss";

const noop = () => {};
const next = () => new Promise(resolve => setTimeout(resolve, 25));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const root = createRoot(document.getElementById("root")!);
// Edge dump-dom advances virtual timers without a paint for each scroll event.
window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
window.cancelAnimationFrame = id => window.clearTimeout(id);
const names = Array.from({ length: 100 }, (_, i) => String(i).padStart(3, "0"));
const sort: SortState = { key: "name", dir: "asc" };
const preview = { registerSource: () => noop, onPress: () => false, open: noop };
let files = names;
let revision = 0;
const entries = (folder: string, separator: string): FileEntry[] => files.map(name => ({
  name, path: folder + separator + name, size: 1, modified: revision, isDir: false,
}));
check(!useSettingsStore.getState().deferOffscreenRemovals, "Stable browsing must be opt-in");
useSettingsStore.setState({ deferOffscreenRemovals: true, remoteThumbnails: false, thumbnailAppIcons: false,
  showParentEntry: false, gridSize: "auto", gridAutoColumns: 2, remoteVideoThumbnails: false });
useRemoteHosts.setState({ profiles: [{ id: "host", name: "Test", destination: "test.example", startPath: "" }],
  connections: { host: { epoch: 1, status: "connected", sessionId: 7, path: "/test" } } });
let journal: RecoveryDetail[] = [{ id: "notice", kind: "delete", host: "test.example", original: "/test/folder",
  sourceHost: "test.example", location: "/test/folder", state: "restored_partial" }];
mockIPC((command, args) => {
  if (command === "webhook_work") return { failures: [], total: 0, missed: 0, error: null };
  if (command === "remote_list") return { path: "/test", sessionId: 7, entries: entries("/test", "/"), omittedEntries: 0 };
  if (command === "remote_recovery_details") return [...journal];
  if (command === "remote_finish_interrupted_transfers") return { restored: [], warnings: ["Partial deletion of /test/folder"] };
  if (command === "remote_recovery_acknowledge") {
    check(args.host === journal[0].host && args.kind === "delete" && args.id === journal[0].id && args.state === journal[0].state, "Wrong recovery record");
    journal = [];
  }
  return [];
}, { shouldMockEvents: true });

type Pane = "main" | "bottom";
function Local({ pane, mode, filter, order }: { pane: Pane; mode: ViewMode; filter: string; order: SortState }) {
  const folder = "C:\\test";
  const data = entries(folder, "\\").filter(e => e.name.includes(filter));
  if (order.dir === "desc") data.reverse();
  const map = new Map(data.map(e => [e.path, e]));
  return <FileView {...useSettingsStore.getState()} pane={pane} viewMode={mode} currentPath={folder}
    entryByPath={map} items={buildEntryItems(data, null)} viewKey={folder} scrollRestoreKey={folder} scrollRestoreTop={0}
    loading={false} showLander={false} canGoUp={false} onGoUp={noop} searchQuery={filter} sortState={order}
    drives={[]} driveInfo={[]} places={[]} recentJumps={[]} onOpenPlace={noop} onOpenRecent={noop} onOpenDrive={noop}
    onSortChange={noop} selectedPaths={new Set()} pendingDeletePaths={new Set()} pendingTransferPaths={new Set()}
    onSelectItem={noop} onSetSelection={noop} onClearSelection={noop} onOpenDir={noop} onOpenEntry={noop}
    onCreateFolder={noop} onCreateFile={noop} onCreateFolderAndGo={noop} renameValue="" onRenameChange={noop}
    onRenameCommit={noop} onRenameCancel={noop} entryMeta={map} onRequestMeta={async () => []}
    thumbnailsEnabled={false} thumbnails={new Map()} onRequestThumbs={async () => {}} presenceEnabled={false} />;
}

async function views(local: Pane, mode: ViewMode) {
  files = names;
  let visit = 0;
  const panes: Pane[] = ["main", "bottom"];
  const render = async (filter = "", order = sort) => {
    revision++;
    flushSync(() => root.render(<>{panes.map(pane => <section key={pane + mode + local + visit} data-file-pane={pane}
      style={{ display: "flex", width: 560, height: 170, position: "relative" }}>
      {pane === local ? <Local pane={pane} mode={mode} filter={filter} order={order} /> : <RemoteFolderView pane={pane} tabId={pane}
        hostId="host" search={filter} path="/test" viewMode={mode} sort={order} refreshVersion={revision}
        onBack={noop} onForward={noop} onNavigate={noop} onOpenTab={noop} onSort={noop} preview={preview}
        canBack={false} canForward={false} />}
    </section>)}</>));
    await next();
  };
  await render();
  const viewport = (pane: Pane) => document.querySelector<HTMLElement>(`[data-file-pane="${pane}"] :is(.list-body,.thumb-viewport)`)!;
  for (let i = 0; i < 40 && !panes.every(p => viewport(p)?.scrollHeight > 800); i++) await next();
  const heights = panes.map(p => viewport(p).scrollHeight);
  check(heights.every(h => h > 800), `${mode} initial geometry ${heights}`);
  const setScroll = (p: Pane, top: number) => {
    const el = viewport(p);
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  };
  // Browse the middle in both panes while items near the beginning disappear.
  for (const p of panes) setScroll(p, viewport(p).scrollHeight / 2);
  const reduced = names.filter(name => +name >= 4);
  files = reduced;
  await render();
  await render();
  check(panes.every((p, i) => viewport(p).scrollHeight === heights[i]), `${mode} refresh shifted an offscreen row`);
  files = names;
  await render();
  for (const p of panes) setScroll(p, 0);
  await next();
  check(panes.every((p, i) => viewport(p).scrollHeight === heights[i]), `${mode} reappearing files were removed`);
  for (const p of panes) setScroll(p, viewport(p).scrollHeight / 2);
  files = reduced;
  await render();
  setScroll("bottom", 0);
  await next();
  check(viewport("bottom").scrollHeight < heights[1] && viewport("main").scrollHeight === heights[0],
    `${mode} scrolling the bottom pane did not release only its rows`);
  setScroll("main", 0);
  await next();
  check(viewport("main").scrollHeight < heights[0], `${mode} main pane retained visible rows`);
  // Re-establish missing slots before changing the query or reopening the folder.
  async function holdFirstRows() {
    files = names;
    await render();
    for (const p of panes) setScroll(p, viewport(p).scrollHeight / 2);
    files = reduced;
    await render();
    check(panes.every((p, i) => viewport(p).scrollHeight === heights[i]), "Offscreen slots were lost before reset");
  }
  await holdFirstRows();
  await render("099");
  check(panes.every(p => viewport(p).scrollHeight <= viewport(p).clientHeight + 160), `${mode} stale slots after filtering`);
  await holdFirstRows();
  await render("", { key: "name", dir: "desc" });
  check(panes.every((p, i) => viewport(p).scrollHeight < heights[i]), `${mode} stale slots after sorting`);
  await holdFirstRows();
  visit++;
  await render();
  check(panes.every((p, i) => viewport(p).scrollHeight < heights[i]), `${mode} stale slots after reopening`);
  if (mode === "list") {
    files = names;
    await render();
    for (const p of panes) setScroll(p, 0);
    await next();
    for (const p of panes) {
      const body = viewport(p);
      const stride = (body.scrollHeight - 20) / names.length;
      setScroll(p, 10 + 4 * stride);
    }
    await next();
    files = ["!new", ...names.filter(name => name !== "002")];
    await render();
    for (const p of panes) {
      const rows = [...viewport(p).querySelectorAll(".row")];
      const slot = viewport(p).querySelector('[data-pending-removal]');
      const index = slot ? rows.indexOf(slot) : -1;
      check(rows[index - 1]?.getAttribute("data-name") === "001" && rows[index + 1]?.getAttribute("data-name") === "003",
        `Pending row sorted outside its neighbors in ${p} (local=${local})`);
      check(slot?.textContent?.includes("Pending removal") && slot.getAttribute("aria-disabled") === "true" &&
        slot.getAttribute("data-selectable") === "false" && !slot.matches("[data-remote-path],[data-path],[data-drag-source]"),
        `Missing or interactive pending row in ${p} (local=${local}, top=${viewport(p).scrollTop}, first=${viewport(p).querySelector("[data-index]")?.getAttribute("data-index")}, height=${viewport(p).scrollHeight}, slot=${slot?.textContent})`);
    }
  }
}

async function run() {
  for (const mode of ["list", "thumbs"] as const) for (const pane of ["main", "bottom"] as const) await views(pane, mode);
  const work = () => <><TransferStatusButton onOpenDestination={noop} /><PromptModal /></>;
  flushSync(() => root.render(work()));
  await checkInterruptedOperations("host", 7, "test.example");
  await next();
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
  button(".prompt-actions button").click();
  await next();
  check(journal.length === 1, "Closing the immediate warning acknowledged it");
  flushSync(() => root.render(null));
  flushSync(() => root.render(work()));
  await next();
  button(".transfer-button").click();
  await next();
  const details = document.querySelector(".recovery-details")?.textContent ?? "";
  check(details.includes("test.example") && details.includes("/test/folder") && details.includes("already have been deleted"), "Recovery details missing after remount");
  button(".recovery-item button").click();
  await next();
  check(!journal.length && !document.querySelector(".recovery-details"), "Acknowledgement did not retire the notice");
}
run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});
