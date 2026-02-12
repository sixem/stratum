// Landing content shown when no folder is selected in the active tab.
import { formatBytes, handleMiddleClick, normalizePath } from "@/lib";
import type { DriveInfo, Place } from "@/types";
import { PinIcon } from "@/components/icons";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PressButton } from "@/components/primitives/PressButton";

type StartLanderProps = {
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
  onOpenRecentNewTab?: (path: string) => void;
  drives: string[];
  driveInfo: DriveInfo[];
  onOpenDrive: (path: string) => void;
  onOpenDriveNewTab?: (path: string) => void;
  places: Place[];
  onOpenPlace: (path: string) => void;
  onOpenPlaceNewTab?: (path: string) => void;
};

const formatDriveLabel = (drive: string) => {
  const trimmed = drive.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("\\\\")) {
    return trimmed;
  }
  if (/^[a-zA-Z]:$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed;
};

const formatDriveName = (info?: DriveInfo) => {
  const label = info?.label?.trim();
  return label ? label : null;
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

const buildDriveInfoMap = (driveInfo: DriveInfo[]) => {
  const map = new Map<string, DriveInfo>();
  driveInfo.forEach((info) => {
    map.set(normalizePath(info.path), info);
  });
  return map;
};

const formatUsage = (info?: DriveInfo) => {
  if (!info || info.total == null || info.free == null) {
    return {
      label: "Size unknown",
      percent: null,
    };
  }
  const used = Math.max(0, info.total - info.free);
  const percent = info.total > 0 ? Math.round((used / info.total) * 100) : 0;
  return {
    label: `${formatBytes(used)} / ${formatBytes(info.total)}`,
    percent: Math.min(100, Math.max(0, percent)),
  };
};

const summarizeStorage = (
  drives: string[],
  driveInfoMap: Map<string, DriveInfo>,
) => {
  let total = 0;
  let free = 0;
  let unknownCount = 0;
  drives.forEach((drive) => {
    const info = driveInfoMap.get(normalizePath(drive));
    if (!info || info.total == null || info.free == null) {
      unknownCount += 1;
      return;
    }
    total += info.total;
    free += info.free;
  });
  if (total <= 0) {
    return {
      label: "Totals unavailable",
      percent: null,
      unknownCount,
    };
  }
  const used = Math.max(0, total - free);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return {
    label: `${formatBytes(used)} / ${formatBytes(total)}`,
    percent: Math.min(100, Math.max(0, percent)),
    unknownCount,
  };
};

export const StartLander = ({
  recentJumps,
  onOpenRecent,
  onOpenRecentNewTab,
  drives,
  driveInfo,
  onOpenDrive,
  onOpenDriveNewTab,
  places,
  onOpenPlace,
  onOpenPlaceNewTab,
}: StartLanderProps) => {
  const visibleRecents = recentJumps;
  const visiblePlaces = places;
  const driveInfoMap = buildDriveInfoMap(driveInfo);
  const knownDrives = drives.filter((drive) => {
    const info = driveInfoMap.get(normalizePath(drive));
    return info?.total != null && info?.free != null;
  });
  const storageSummary = summarizeStorage(knownDrives, driveInfoMap);
  return (
    <div className="view-lander">
      <div className="lander-panel">
        <EmptyState
          title="Start browsing"
          subtitle="Choose a location below or enter a path above."
        />
        <div className="lander-columns">
          <div
            className={`lander-drives lander-section${knownDrives.length === 0 ? " is-empty" : ""}`}
          >
            <div className="lander-section-head">
              <div className="lander-section-title">Drives</div>
              <span className="lander-section-count">{knownDrives.length}</span>
            </div>
            <div className="lander-storage-summary">
              <span className="lander-storage-title">Total storage</span>
              <span className="lander-storage-value">{storageSummary.label}</span>
              {storageSummary.percent != null ? (
                <span className="lander-storage-percent">
                  {storageSummary.percent}% used
                </span>
              ) : null}
            </div>
            {storageSummary.percent != null ? (
              <div className="lander-storage-bar">
                <span
                  className="lander-storage-bar-fill"
                  style={{ width: `${storageSummary.percent}%` }}
                />
              </div>
            ) : null}
            {knownDrives.length === 0 ? (
              <div className="lander-drives-empty">No drives with size data</div>
            ) : (
              <div className="lander-drives-list">
                {knownDrives.map((drive) => {
                  const info = driveInfoMap.get(normalizePath(drive));
                  const name = formatDriveName(info);
                  const usage = formatUsage(info);
                  return (
                    <PressButton
                      key={drive}
                      type="button"
                      className="lander-drive"
                      onClick={() => onOpenDrive(drive)}
                      onMouseDown={(event) => {
                        if (!onOpenDriveNewTab) return;
                        handleMiddleClick(event, () => onOpenDriveNewTab(drive));
                      }}
                    >
                      <div className="lander-drive-head">
                        <span className="lander-drive-label">
                          {formatDriveLabel(drive)}
                        </span>
                        {name ? <span className="lander-drive-name">{name}</span> : null}
                      </div>
                      <div className="lander-drive-usage">
                        <span className="lander-drive-usage-label">{usage.label}</span>
                        {usage.percent != null ? (
                          <span className="lander-drive-usage-percent">
                            {usage.percent}% used
                          </span>
                        ) : null}
                      </div>
                      <div className="lander-drive-bar" data-known="true">
                        <span
                          className="lander-drive-bar-fill"
                          style={{
                            width:
                              usage.percent != null ? `${usage.percent}%` : "0%",
                          }}
                        />
                      </div>
                    </PressButton>
                  );
                })}
              </div>
            )}
          </div>
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
                    key={place.path}
                    type="button"
                    className="place lander-place"
                    data-pinned={place.pinned ? "true" : "false"}
                    onClick={() => onOpenPlace(place.path)}
                    onMouseDown={(event) => {
                      if (!onOpenPlaceNewTab) return;
                      handleMiddleClick(event, () =>
                        onOpenPlaceNewTab(place.path),
                      );
                    }}
                  >
                    <div className="lander-place-head">
                      <span className="place-name lander-place-name">
                        {place.name}
                      </span>
                      {place.pinned ? (
                        <span className="place-pin" aria-label="Pinned place" title="Pinned place">
                          <PinIcon className="place-pin-icon" />
                        </span>
                      ) : null}
                    </div>
                    <span className="place-path lander-place-path">{place.path}</span>
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
