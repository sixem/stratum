// Landing content shown when no folder is selected in the active tab.
import { handleMiddleClick } from "@/lib";
import { useLocationDrag } from "@/hooks/ui/inputs/useLocationDrag";
import type { DriveInfo, Place } from "@/types";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PinShapeIcon } from "@/components/icons/PinShapeIcon";
import { useSettingsStore } from "@/modules/settings.store";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { openRemotePlace, remotePlaceSubtitle } from "@/modules/remotePlaces";
import { placeKey } from "@/lib/placeLocation";
import type { LinkedPane } from "@/lib/paneLink";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PressButton } from "@/components/primitives/PressButton";
import { StartLanderDrives } from "./StartLanderDrives";

type StartLanderProps = {
  pane: LinkedPane;
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
  onOpenRecentNewTab?: (path: string) => void;
  drives: string[];
  drivesLoaded?: boolean;
  driveInfoLoaded?: boolean;
  driveInfo: DriveInfo[];
  onOpenDrive: (path: string) => void;
  onOpenDriveNewTab?: (path: string) => void;
  places: Place[];
  onOpenPlace: (path: string) => void;
  onOpenPlaceNewTab?: (path: string) => void;
};

const formatRecentLabel = (path: string) => {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return path;
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return trimmed;
  return parts[parts.length - 1] ?? trimmed;
};

const formatRecentDriveTag = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("\\\\")) {
    const parts = trimmed.replace(/^\\\\/, "").split("\\");
    if (parts.length >= 2) {
      return `\\\\${parts[0]}\\${parts[1]}`;
    }
    return "\\\\";
  }
  const match = trimmed.match(/^[a-zA-Z]:/);
  return match ? match[0].toUpperCase() : null;
};

export const StartLander = ({
  pane,
  recentJumps,
  onOpenRecent,
  onOpenRecentNewTab,
  drives,
  drivesLoaded = true,
  driveInfoLoaded = true,
  driveInfo,
  onOpenDrive,
  onOpenDriveNewTab,
  places,
  onOpenPlace,
  onOpenPlaceNewTab,
}: StartLanderProps) => {
  const profiles = useRemoteHosts(state => state.profiles);
  const pinShape = useSettingsStore(state => state.pinShape);
  const openPlace = (place: Place, newTab = false) => {
    if (place.hostId) openRemotePlace({ hostId: place.hostId, path: place.path }, pane, newTab);
    else if (newTab) onOpenPlaceNewTab?.(place.path);
    else onOpenPlace(place.path);
  };
  const visibleRecents = recentJumps;
  const visiblePlaces = places;
  const locationDrag = useLocationDrag();
  return (
    <div className="view-lander" data-tab-content="lander" {...locationDrag}>
      <div className="lander-panel">
        <EmptyState
          title="Start browsing"
          subtitle="Choose a location below or enter a path above."
        />
        <div className="lander-columns">
          <StartLanderDrives
            drives={drives}
            driveInfo={driveInfo}
            loading={!drivesLoaded || !driveInfoLoaded}
            onOpenDrive={onOpenDrive}
            onOpenDriveNewTab={onOpenDriveNewTab}
          />
          <div
            className={`lander-recents lander-section${visibleRecents.length === 0 ? " is-empty" : ""}`}
          >
            <div className="lander-section-head">
              <div className="lander-section-title">Recent locations</div>
              <span className="lander-section-count">{visibleRecents.length}</span>
            </div>
            {visibleRecents.length === 0 ? (
              <div className="lander-recents-empty">No jumps yet</div>
            ) : (
              <div className="lander-recents-list">
                {visibleRecents.map((path) => {
                  const title = formatRecentLabel(path);
                  const driveTag = formatRecentDriveTag(path);
                  return (
                    <PressButton
                      key={path}
                      type="button"
                      className="place lander-place"
                      data-location-path={path}
                      pressOnPointerDown={false}
                      onClick={() => onOpenRecent(path)}
                      onMouseDown={(event) => {
                        if (!onOpenRecentNewTab) return;
                        handleMiddleClick(event, () => onOpenRecentNewTab(path));
                      }}
                    >
                      <div className="lander-place-head">
                        <span className="place-name lander-place-name">{title}</span>
                        {driveTag ? (
                          <span className="lander-place-drive">{driveTag}</span>
                        ) : null}
                      </div>
                      <span className="place-path lander-place-path">{path}</span>
                    </PressButton>
                  );
                })}
              </div>
            )}
          </div>
          <div
            className={`lander-places lander-section${visiblePlaces.length === 0 ? " is-empty" : ""}`}
          >
            <div className="lander-section-head">
              <div className="lander-section-title">Places</div>
              <span className="lander-section-count">{visiblePlaces.length}</span>
            </div>
            {visiblePlaces.length === 0 ? (
              <div className="lander-recents-empty">No places found</div>
            ) : (
              <div className="lander-recents-list">
                {visiblePlaces.map((place) => (
                  <PressButton
                    key={placeKey(place)}
                    type="button"
                    className="place lander-place"
                    data-location-path={place.hostId ? undefined : place.path}
                    pressOnPointerDown={false}
                    data-pinned={place.pinned ? "true" : "false"}
                    onClick={() => openPlace(place)}
                    onMouseDown={(event) => {
                      if (!place.hostId && !onOpenPlaceNewTab) return;
                      handleMiddleClick(event, () =>
                        openPlace(place, true),
                      );
                    }}
                  >
                    <div className="lander-place-head">
                      <span className="place-name lander-place-name">
                        {place.name}
                      </span>
                      {place.pinned ? (
                        <TooltipWrapper text="Pinned place">
                          <span className="place-pin" style={{ color: place.pinColor }} aria-hidden="true">
                            <PinShapeIcon shape={pinShape} className="place-pin-icon" />
                          </span>
                        </TooltipWrapper>
                      ) : null}
                    </div>
                    <span className="place-path lander-place-path">{place.hostId ? remotePlaceSubtitle(place.path, profiles.find(profile => profile.id === place.hostId)) : place.path}</span>
                  </PressButton>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
