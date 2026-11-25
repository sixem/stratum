// Keep live location shortcuts attached to a folder after renaming it.
import { getPathName } from "@/lib/paths";
import { mapTabLocations } from "@/lib/tabLocations";
import type { Tab, TabHistory } from "@/types/tabs";
import { createBackupPathRemapper } from "./backup/locations";
import { useBottomPaneStore } from "./bottomPaneStore";
import { coercePlacesState, usePlacesStore } from "./placesStore";
import { useBottomSessionStore, useSessionStore } from "./sessionStore";

type MapLocation = (path: string) => string;
const listeners = new Set<(mapPath: MapLocation) => void>();

export const subscribeToFolderRename = (listener: (mapPath: MapLocation) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const mapTabHistoryLocations = (history: TabHistory, mapPath: MapLocation): TabHistory => ({
  back: history.back.map(mapPath),
  forward: history.forward.map(mapPath),
});

export const updateRenamedFolderLocations = (from: string, to: string) => {
  if (from === to) return;
  const mapPath = createBackupPathRemapper([{ from, to }]);
  const mapTab = (tab: Tab) => mapTabLocations(tab, mapPath);

  // Retarget the panes' in-flight requests before exposing the renamed tab paths.
  listeners.forEach((listener) => listener(mapPath));
  for (const session of [useSessionStore, useBottomSessionStore]) {
    const { tabs, recentJumps, closedTabs, updateSession } = session.getState();
    updateSession({
      tabs: tabs.map(mapTab),
      recentJumps: [...new Set(recentJumps.map(mapPath))],
      closedTabs: closedTabs.map((entry) => ({
        ...entry,
        tab: mapTab(entry.tab),
        history: entry.history && mapTabHistoryLocations(entry.history, mapPath),
      })),
    });
  }
  usePlacesStore.setState((state) => {
    const places = state.places.map((place) => {
      const path = mapPath(place.path);
      if (path === place.path) return place;
      const name = place.name === getPathName(place.path) ? getPathName(path) : place.name;
      return { ...place, path, name };
    });
    return places.some((place, index) => place !== state.places[index])
      ? coercePlacesState({ places, initialized: state.initialized })
      : state;
  });
  const { link, navigation } = useBottomPaneStore.getState();
  if (link || navigation) {
    useBottomPaneStore.setState({
      link: link && {
        ...link,
        mainRootPath: mapPath(link.mainRootPath),
        bottomRootPath: mapPath(link.bottomRootPath),
      },
      navigation: navigation && { ...navigation, path: mapPath(navigation.path) },
    });
  }
};
