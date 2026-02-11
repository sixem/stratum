// Compact drive selector used in the path bar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeDrive, buildDriveTooltip, handleMiddleClick, normalizePath } from "@/lib";
import type { DriveInfo } from "@/types";
import { PressButton } from "@/components/primitives/PressButton";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type DrivePickerProps = {
  activePath: string;
  drives: string[];
  driveInfo: DriveInfo[];
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

const ChevronIcon = ({ direction }: { direction: "left" | "right" }) => {
  const d = direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="drive-picker-chevron"
      fill="none"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
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
  const active = activeDrive(activePath, drives);
  const activeKey = active ? normalizePath(active) : "";
  const activeIndex = activeKey ? normalizedDrives.indexOf(activeKey) : -1;
  const label = active ? formatDriveLabel(active) : "Drives";
  const extraCount =
    drives.length > 0 ? Math.max(0, drives.length - (activeIndex >= 0 ? 1 : 0)) : 0;
  const displayLabel = extraCount > 0 ? `${label} +${extraCount}` : label;
  const canOpen = drives.length > 1;
  const activeTooltip = active
    ? buildDriveTooltip(label, driveInfoMap.get(activeKey))
    : "Drives";

  // Track overflow so we only show navigation affordances when needed.
  const updateScrollState = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = list;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

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
    window.addEventListener("resize", updateScrollState);
    list?.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = list ? new ResizeObserver(updateScrollState) : null;
    if (observer && list) {
      observer.observe(list);
    }
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("resize", updateScrollState);
      list?.removeEventListener("scroll", updateScrollState);
      observer?.disconnect();
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
              {displayLabel}
            </PressButton>
          </TooltipWrapper>
          <div className="drive-picker-extend">
            <div
              className="drive-picker-scroll"
              data-can-left={canScrollLeft ? "true" : "false"}
              data-can-right={canScrollRight ? "true" : "false"}
            >
              <PressButton
                type="button"
                className="drive-picker-scroll-button is-left"
                onClick={() => {
                  const list = listRef.current;
                  if (!list) return;
                  list.scrollBy({
                    left: -Math.max(220, list.clientWidth * 0.6),
                    behavior: "smooth",
                  });
                }}
                aria-label="Scroll drives left"
                disabled={!canScrollLeft}
              >
                <ChevronIcon direction="left" />
              </PressButton>
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
              <PressButton
                type="button"
                className="drive-picker-scroll-button is-right"
                onClick={() => {
                  const list = listRef.current;
                  if (!list) return;
                  list.scrollBy({
                    left: Math.max(220, list.clientWidth * 0.6),
                    behavior: "smooth",
                  });
                }}
                aria-label="Scroll drives right"
                disabled={!canScrollRight}
              >
                <ChevronIcon direction="right" />
              </PressButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
