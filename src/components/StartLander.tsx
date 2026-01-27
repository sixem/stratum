// Landing content shown when no folder is selected in the active tab.
import { formatBytes, normalizePath } from "@/lib";
import type { DriveInfo } from "@/types";
import { EmptyState } from "./EmptyState";

type StartLanderProps = {
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
  drives: string[];
  driveInfo: DriveInfo[];
  onOpenDrive: (path: string) => void;
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

export const StartLander = ({
  recentJumps,
  onOpenRecent,
  drives,
  driveInfo,
  onOpenDrive,
}: StartLanderProps) => {
  const driveInfoMap = buildDriveInfoMap(driveInfo);
  return (
    <div className="view-lander">
      <div className="lander-panel">
        <EmptyState
          title="Start browsing"
          subtitle="Choose a location from the sidebar or enter a path above."
        />
        <div className="lander-drives">
          <div className="lander-section-title">Drives</div>
          {drives.length === 0 ? (
            <div className="lander-drives-empty">No drives found</div>
          ) : (
            <div className="lander-drives-list">
              {drives.map((drive) => {
                const info = driveInfoMap.get(normalizePath(drive));
                const name = formatDriveName(info);
                const usage = formatUsage(info);
                return (
                  <button
                    key={drive}
                    type="button"
                    className="lander-drive"
                    onClick={() => onOpenDrive(drive)}
                    title={drive}
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
                    <div
                      className="lander-drive-bar"
                      data-known={usage.percent != null ? "true" : "false"}
                    >
                      <span
                        className="lander-drive-bar-fill"
                        style={{
                          width:
                            usage.percent != null ? `${usage.percent}%` : "0%",
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="lander-recents">
          <div className="lander-section-title">Recent locations</div>
          {recentJumps.length === 0 ? (
            <div className="lander-recents-empty">No jumps yet</div>
          ) : (
            <div className="lander-recents-list">
              {recentJumps.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="place lander-place"
                  onClick={() => onOpenRecent(path)}
                  title={path}
                >
                  <span className="lander-place-path">{path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
