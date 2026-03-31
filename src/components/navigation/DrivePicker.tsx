// Compact drive selector used in the path bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { activeDrive, buildDriveTooltip, handleMiddleClick, normalizePath } from "@/lib";
import { useHorizontalOverflowScroll } from "@/hooks";
import type { DriveInfo } from "@/types";
import { HorizontalChevronButton, PressButton } from "@/components/primitives";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type DrivePickerProps = {
  activePath: string;
  drives: string[];
  driveInfo: DriveInfo[];
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
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

export const DrivePicker = ({
  activePath,
  drives,
  driveInfo,
  onSelect,
  onSelectNewTab,
}: DrivePickerProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const driveInfoMap = useMemo(() => {
    const map = new Map<string, DriveInfo>();
    driveInfo.forEach((info) => {
      map.set(normalizePath(info.path), info);
    });
    return map;
  }, [driveInfo]);
  const normalizedDrives = useMemo(
    () => drives.map((drive) => normalizePath(drive)),
    [drives],
  );
  const hasLoadedDrives = drives.length > 0;
  const active = activeDrive(activePath, drives);
  const activeKey = active ? normalizePath(active) : "";
  const activeIndex = activeKey ? normalizedDrives.indexOf(activeKey) : -1;
  const label = active ? formatDriveLabel(active) : hasLoadedDrives ? "Drives" : "";
  const extraCount =
    drives.length > 0 ? Math.max(0, drives.length - (activeIndex >= 0 ? 1 : 0)) : 0;
  const displayLabel = hasLoadedDrives
    ? extraCount > 0
      ? `${label} +${extraCount}`
      : label
    : "";
  const canOpen = drives.length > 1;
  const activeTooltip = active
    ? buildDriveTooltip(label, driveInfoMap.get(activeKey))
    : hasLoadedDrives
      ? "Drives"
      : "";
  const { canScrollLeft, canScrollRight, scrollByDirection, updateScrollState } =
    useHorizontalOverflowScroll(listRef, {
      enabled: expanded,
      refreshKey: drives,
    });

  useEffect(() => {
    if (!expanded) return;
    const list = listRef.current;
    if (list) {
      const activeButton = list.querySelector<HTMLButtonElement>(
        ".drive-picker-item.is-active",
      );
      if (activeButton) {
        activeButton.scrollIntoView({ block: "nearest", inline: "center" });
      }
    }
    updateScrollState();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!containerRef.current?.contains(target)) {
        setExpanded(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [expanded, updateScrollState, drives]);

  const handleToggle = () => {
    if (!canOpen) return;
    setExpanded((prev) => !prev);
  };

  return (
    <div
      className="drive-picker"
      data-expanded={expanded ? "true" : "false"}
      ref={containerRef}
    >
      <div className="drive-toggle">
        <div className="drive-toggle-body" role="menu">
          <TooltipWrapper text={activeTooltip}>
            <PressButton
              type="button"
              className="drive-picker-button"
              onClick={handleToggle}
              disabled={!canOpen}
              aria-disabled={!canOpen}
              aria-haspopup="menu"
              aria-expanded={expanded}
            >
              <span
                className="drive-picker-button-label"
                data-loaded={hasLoadedDrives ? "true" : "false"}
              >
                {displayLabel}
              </span>
            </PressButton>
          </TooltipWrapper>
          <div className="drive-picker-extend">
            <div
              className="drive-picker-scroll"
              data-can-left={canScrollLeft ? "true" : "false"}
              data-can-right={canScrollRight ? "true" : "false"}
            >
              <HorizontalChevronButton
                type="button"
                className="drive-picker-scroll-button is-left"
                iconClassName="drive-picker-chevron"
                direction="left"
                onClick={() => scrollByDirection("left")}
                aria-label="Scroll drives left"
                disabled={!canScrollLeft}
              />
              <div className="drive-picker-list" role="presentation" ref={listRef}>
                {drives.map((drive) => {
                  const driveLabel = formatDriveLabel(drive);
                  const isActive = normalizePath(drive) === activeKey;
                  const tooltipText = buildDriveTooltip(
                    driveLabel,
                    driveInfoMap.get(normalizePath(drive)),
                  );
                  return (
                    <TooltipWrapper key={drive} text={tooltipText}>
                      <PressButton
                        type="button"
                        role="menuitem"
                        className={`drive-picker-item${isActive ? " is-active" : ""}`}
                        onClick={() => {
                          setExpanded(false);
                          onSelect(drive);
                        }}
                        onMouseDown={(event) => {
                          if (!onSelectNewTab) return;
                          handleMiddleClick(event, () => {
                            setExpanded(false);
                            onSelectNewTab(drive);
                          });
                        }}
                      >
                        {driveLabel}
                      </PressButton>
                    </TooltipWrapper>
                  );
                })}
              </div>
              <HorizontalChevronButton
                type="button"
                className="drive-picker-scroll-button is-right"
                iconClassName="drive-picker-chevron"
                direction="right"
                onClick={() => scrollByDirection("right")}
                aria-label="Scroll drives right"
                disabled={!canScrollRight}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
