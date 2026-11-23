// Storage summary and drive cards for the new-tab view.
import { buildDriveTooltip, formatBytes, handleMiddleClick, normalizePath } from "@/lib";
import type { DriveInfo } from "@/types";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";

type StartLanderDrivesProps = {
  drives: string[];
  driveInfo: DriveInfo[];
  loading: boolean;
  onOpenDrive: (path: string) => void;
  onOpenDriveNewTab?: (path: string) => void;
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

const summarizeStorage = (
  drives: string[],
  driveInfoMap: Map<string, DriveInfo>,
) => {
  let total = 0;
  let free = 0;
  drives.forEach((drive) => {
    const info = driveInfoMap.get(normalizePath(drive));
    if (!info || info.total == null || info.free == null) return;
    total += info.total;
    free += info.free;
  });
  if (total <= 0) return null;
  const used = Math.max(0, total - free);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return {
    label: `${formatBytes(used)} / ${formatBytes(total)}`,
    percent: Math.min(100, Math.max(0, percent)),
  };
};

export const StartLanderDrives = ({
  drives,
  driveInfo,
  loading,
  onOpenDrive,
  onOpenDriveNewTab,
}: StartLanderDrivesProps) => {
  const infoByPath = buildDriveInfoMap(driveInfo);
  const summary = summarizeStorage(drives, infoByPath);

  return (
    <section className="lander-drives lander-section" aria-label="Drives and storage" aria-busy={loading}>
      <div className="lander-section-head">
        <div className="lander-section-title">Drives</div>
        <span className="lander-section-count" aria-hidden={loading || undefined}>
          {loading ? "–" : drives.length}
        </span>
      </div>
      <div className="lander-storage">
        <div className="lander-storage-summary">
          <span className="lander-storage-title">Total storage</span>
          {loading ? (
            <span className="lander-skeleton lander-storage-placeholder" aria-hidden="true" />
          ) : (
            <>
              <span className="lander-storage-value tnum">{summary?.label ?? "Unavailable"}</span>
              {summary && <span className="lander-storage-percent tnum">{summary.percent}% used</span>}
            </>
          )}
        </div>
        <div className="lander-storage-bar" aria-hidden="true">
          <span className="lander-storage-bar-fill" style={{ width: `${summary?.percent ?? 0}%` }} />
        </div>
      </div>
      <div className="lander-drives-list" data-loading={loading}>
        {loading ? (
          Array.from({ length: 8 }, (_, index) => (
            <div className="lander-drive lander-drive-placeholder" aria-hidden="true" key={index}>
              <span className="lander-skeleton" />
              <span className="lander-skeleton" />
              <div className="lander-drive-bar" data-known="false" />
            </div>
          ))
        ) : drives.length === 0 ? (
          <div className="lander-drives-empty">No drives found</div>
        ) : drives.map((drive) => {
          const info = infoByPath.get(normalizePath(drive));
          const label = formatDriveLabel(drive);
          const name = formatDriveName(info);
          const usage = formatUsage(info);

          return (
            <TooltipWrapper key={drive} text={buildDriveTooltip(label, info)}>
              <PressButton
                type="button"
                className="lander-drive"
                data-location-path={drive}
                pressOnPointerDown={false}
                onClick={() => onOpenDrive(drive)}
                onMouseDown={(event) => {
                  if (onOpenDriveNewTab) handleMiddleClick(event, () => onOpenDriveNewTab(drive));
                }}
              >
                <div className="lander-drive-head">
                  <span className="lander-drive-label">{label}</span>
                  {name && <span className="lander-drive-name">{name}</span>}
                </div>
                <div className="lander-drive-usage">
                  <span className="lander-drive-usage-label tnum">{usage.label}</span>
                  {usage.percent != null && (
                    <span className="lander-drive-usage-percent tnum">{usage.percent}% used</span>
                  )}
                </div>
                <div className="lander-drive-bar" data-known={usage.percent != null} aria-hidden="true">
                  <span className="lander-drive-bar-fill" style={{ width: `${usage.percent ?? 0}%` }} />
                </div>
              </PressButton>
            </TooltipWrapper>
          );
        })}
      </div>
    </section>
  );
};
