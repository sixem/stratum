// Exercise the shared Places store and sidebar against the mounted SFTP views.
import { createRoot } from "react-dom/client";
import { Sidebar } from "@/components/navigation/Sidebar";
import { setBottomPaneActive } from "@/modules/bottomPaneStore";
import { coercePlacesState, usePlacesStore } from "@/modules/placesStore";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";
import { PLACES_STORAGE_KEY } from "@/constants";

const noop = () => {};
function Places() {
  const places = usePlacesStore(state => state.places);
  return <Sidebar places={places} recentJumps={[]} activePath="" sectionOrder={["places"]} hiddenSections={["recent", "tips"]}
    onSelect={() => { throw Error("A remote place requested local navigation"); }} onSelectRecent={noop}
    onReorderPinnedPlace={usePlacesStore.getState().reorderPinnedPlace} onOpenTipsMenu={noop} />;
}

export async function exerciseRemotePlaces(waitFor: (condition: () => unknown, message: string) => Promise<void>, finishConnection: () => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<Places />);
  const folder = document.querySelector<HTMLElement>('[data-file-pane="main"] [data-remote-path="/main/folder"]')!;
  folder.dispatchEvent(new PointerEvent("pointerup", { button: 2, bubbles: true }));
  const pin = () => [...document.querySelectorAll<HTMLButtonElement>(".context-item")].find(button => button.textContent === "Pin to places");
  await waitFor(pin, "Remote folder menu did not offer Pin to places");
  pin()!.click();
  const location = { hostId: "main", path: "/main/folder" };
  const store = usePlacesStore.getState();
  store.addPlace({ ...location, hostId: "bottom" }, undefined, { pinned: true });
  store.addPlace({ ...location, path: "/main/Folder " }, undefined, { pinned: true });
  store.addPlace("C:\\local", undefined, { pinned: true });
  store.setPinColor(location, "#ad86d9");
  useSettingsStore.setState({ pinShape: "square" });
  const restored = coercePlacesState(JSON.parse(localStorage.getItem(PLACES_STORAGE_KEY)!)).places;
  if (restored.length !== 4 || restored.filter(p => p.pinColor).length !== 1 ||
      !restored.some(p => p.hostId === "main" && p.path === "/main/Folder ")) throw Error("Place identities or colors were lost on reload");
  const button = () => host.querySelector<HTMLButtonElement>('button[data-place-host="main"][data-remote-place-path="/main/folder"]');
  await waitFor(() => button()?.querySelector(".place-pin rect"), "Remote place did not render its pin shape");
  if (!button()!.textContent?.includes("main · /main/folder") || button()!.dataset.path) throw Error("Sidebar lost the host or exposed a local drop path");
  for (const pane of ["main", "bottom"] as const) {
    setBottomPaneActive(pane === "bottom");
    await new Promise(resolve => setTimeout(resolve, 20));
    if (pane === "bottom") useRemoteHosts.setState(state => ({
      connections: { ...state.connections, main: { status: "disconnected", epoch: 5 } },
    }));
    button()!.click();
    const session = getPaneSessionStore(pane).getState();
    const tab = session.tabs.find(item => item.id === session.activeTabId);
    if (tab?.kind !== "remote" || tab.remote.hostId !== "main" || tab.remote.path !== location.path) throw Error("Pin opened the wrong destination in " + pane);
    button()!.click();
    if (getPaneSessionStore(pane).getState().tabs.length !== session.tabs.length) throw Error("Selecting the same pin duplicated its tab");
    if (pane === "bottom") {
      await waitFor(() => useRemoteHosts.getState().connections.main?.status === "connecting", "Pin did not reconnect its host");
      await finishConnection();
      await waitFor(() => useRemoteHosts.getState().connections.main?.status === "connected", "Pin did not finish connecting");
    }
  }
  store.removePlace(location);
  if (!usePlacesStore.getState().places.some(p => p.hostId === "bottom" && p.path === location.path)) throw Error("Removing a pin removed another host's place");
  root.unmount();
  host.remove();
}
