// Exercise the footer with real remote connection and refresh states.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { AppStatusbar } from "@/components/app/AppStatusbar";
import { RemoteFolderView } from "@/components/remote/RemoteFolderView";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { useUpdateStore } from "@/modules/updateStore";

const noop = () => {};
const preview = { registerSource: () => noop, onPress: () => false, open: noop };
let finishList: (() => void) | undefined;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function wait(condition: () => unknown, message: string) {
  const until = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > until) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function footer(message: string, loading: boolean) {
  const status = document.querySelector(".status-text-content");
  check(status?.textContent === message, `Expected footer ${message}, got ${status?.textContent}`);
  check(Boolean(status.querySelector(".status-text-loading-icon")) === loading, `Wrong loader for ${message}`);
  if (loading) check(status.firstElementChild?.matches(".status-text-loading-icon"), "Loader should precede the label");
}

async function run() {
  mockIPC(async (command, args: any) => {
    if (command === "remote_list") {
      await new Promise<void>(resolve => { finishList = resolve; });
      return { path: args.path, sessionId: args.sessionId, omittedEntries: 0, entries: [] };
    }
    return [];
  }, { shouldMockEvents: true });
  useRemoteHosts.setState({ profiles: [{ id: "main", name: "Host", destination: "host", startPath: "" }],
    connections: { main: { status: "connecting", epoch: 1 } } });
  useBottomPaneStore.setState({ open: false, active: false });

  function Fixture() {
    const [revision, setRevision] = useState(0);
    const [indexing, setIndexing] = useState(true);
    return <>
      <button id="refresh" onClick={() => setRevision(value => value + 1)}>Refresh</button>
      <button id="ready" onClick={() => setIndexing(false)}>Ready</button>
      <RemoteFolderView pane="main" tabId="tab" hostId="main" path="/test" refreshVersion={revision}
        search="" sort={{ key: "name", dir: "asc" }} viewMode="list" preview={preview}
        canBack={false} canForward={false} onBack={noop} onForward={noop} onNavigate={noop} onOpenTab={noop} onSort={noop} />
      <AppStatusbar statusBar={{ countLabel: "", selectionLabel: "", level: indexing ? "loading" : "idle",
        message: indexing ? "Applying changes on C:" : "Ready" }} />
    </>;
  }
  createRoot(document.getElementById("root")!).render(<Fixture />);
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Connecting…", "No connecting status");
  footer("Connecting…", true);
  useRemoteHosts.setState({ connections: { main: { status: "connected", epoch: 1, sessionId: 7, path: "/test" } } });
  await wait(() => finishList && document.querySelector(".status-text-label")?.textContent === "Loading folder…", "No loading status");
  footer("Loading folder…", true);
  finishList!(); finishList = undefined;
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Applying changes on C:", "Index status hidden by remote pane");
  footer("Applying changes on C:", true);
  document.getElementById("refresh")!.click();
  await wait(() => finishList && document.querySelector(".status-text-label")?.textContent === "Refreshing folder…", "No refresh status");
  footer("Refreshing folder…", true);
  finishList!(); finishList = undefined;
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Applying changes on C:", "Refresh did not finish");
  document.getElementById("ready")!.click();
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Ready", "Ready status missing");
  footer("Ready", false);
  useUpdateStore.setState({ status: "checking" });
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Checking for updates", "Update check missing");
  footer("Checking for updates", true);
  useRemoteHosts.setState({ connections: { main: { status: "disconnected", epoch: 2 } } });
  await wait(() => document.querySelector(".status-text-label")?.textContent === "Disconnected", "Disconnected status missing");
  footer("Disconnected", false);
}
run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});
