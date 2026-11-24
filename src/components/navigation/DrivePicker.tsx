// Compact drive selector used in the path bar.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  activeDrive,
  buildDriveTooltip,
  formatIndexedDriveState,
  handleMiddleClick,
  isCheckingIndexedDrive,
  normalizePath,
} from "@/lib";
import { useHorizontalOverflowScroll } from "@/hooks";
import { useLocationDrag } from "@/hooks/ui/inputs/useLocationDrag";
import type { DriveInfo, IndexedDriveState, IndexedSearchServiceState } from "@/types";
import { HorizontalChevronButton, PressButton } from "@/components/primitives";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { useOverlayDismiss } from "@/components/overlay/useOverlayDismiss";
import { useDrivePickerDragScroll } from "./useDrivePickerDragScroll";

type DrivePickerProps = {
  activePath: string;
  drives: string[];
  drivesLoading: boolean;
  driveInfo: DriveInfo[];
  indexedSearchState?: IndexedSearchServiceState;
  collapseOnBlur?: boolean;
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

type DriveMarkerState = IndexedDriveState | "checking" | "loading";

const getDriveIndexState = (info: DriveInfo | undefined, serviceState?: IndexedSearchServiceState) => {
  const state = info?.indexStatus?.state;
  return isCheckingIndexedDrive(state, serviceState === "starting") ? "checking" : state;
};

const buildDriveAriaLabel = (driveLabel: string, state?: DriveMarkerState) => {
  if (state === "loading") return "Loading drives";
  if (state === "checking") return `${driveLabel}. Checking index.`;
  return state ? `${driveLabel}. Indexed search ${formatIndexedDriveState(state).toLowerCase()}.` : driveLabel;
};

const DriveStatusMarker = ({ state }: { state?: DriveMarkerState }) => {
  if (!state) return null;
  return <span className="drive-picker-status" data-state={state} aria-hidden="true" />;
};

export const DrivePicker = ({
  activePath,
  drives,
  drivesLoading,
  driveInfo,
  indexedSearchState,
  collapseOnBlur = false,
  onSelect,
  onSelectNewTab,
}: DrivePickerProps) => {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [driveListOpen, setDriveListOpen] = useState(false);
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
  const hasDrives = drives.length > 0;
  const active = activeDrive(activePath, drives) ?? (drives.length === 1 ? drives[0] : null);
  const activeKey = active ? normalizePath(active) : "";
  const activeInfo = activeKey ? driveInfoMap.get(activeKey) : undefined;
  const activeIndexedState = !hasDrives && drivesLoading ? "loading" : getDriveIndexState(activeInfo, indexedSearchState);
  const activeIndex = activeKey ? normalizedDrives.indexOf(activeKey) : -1;
  const label = active ? formatDriveLabel(active) : hasDrives ? "Drives" : drivesLoading ? "Drives…" : "No drives";
  const extraCount = drives.length - (activeIndex >= 0 ? 1 : 0);
  const displayLabel = extraCount > 0 ? `${label} +${extraCount}` : label;
  const canOpen = drives.length > 1;
  const expanded = canOpen && driveListOpen;
  // Keep the same trigger width across drive letters and both toggle states.
  const labelSpacer = canOpen && /^[A-Z]:$/.test(label) ? `W: +${extraCount}` : null;
  const activeTooltip = activeIndexedState === "loading"
    ? "Loading drives"
    : buildDriveTooltip(label, activeInfo, activeIndexedState === "checking" ? "Checking index" : undefined);
  const { canScrollLeft, canScrollRight, overflowed, scrollByDirection, updateScrollState } =
    useHorizontalOverflowScroll(listRef, {
      enabled: expanded,
      refreshKey: drives,
    });
  const canDrag = expanded && overflowed;
  const { dragging, dragHandlers } = useDrivePickerDragScroll(canDrag);
  const locationDrag = useLocationDrag(canDrag);
  const dismissRefs = useMemo(() => [pickerRef], []);
  const collapse = useCallback(() => setDriveListOpen(false), []);
  const dismissOnBlur = expanded && collapseOnBlur;

  useOverlayDismiss({
    enabled: dismissOnBlur,
    refs: dismissRefs,
    pointerDownCapture: true,
    onPointerDownOutside: collapse,
  });

  useEffect(() => {
    if (!dismissOnBlur) return;
    window.addEventListener("blur", collapse);
    return () => window.removeEventListener("blur", collapse);
  }, [dismissOnBlur, collapse]);

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
  }, [expanded, updateScrollState, drives]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expanded || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    collapse();
    toggleRef.current?.focus();
  };

  return (
    <div
      className="drive-picker"
      data-expanded={expanded ? "true" : "false"}
      ref={pickerRef}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (dismissOnBlur && next instanceof Node && !event.currentTarget.contains(next)) collapse();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="drive-toggle">
        <div className="drive-toggle-body" role="menu">
          <TooltipWrapper text={activeTooltip}>
            <PressButton
              ref={toggleRef}
              type="button"
              className="drive-picker-button"
              onClick={() => setDriveListOpen((open) => !open)}
              disabled={!canOpen}
              aria-disabled={!canOpen}
              aria-busy={activeIndexedState === "loading"}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-label={buildDriveAriaLabel(displayLabel, activeIndexedState)}
            >
              <span className="drive-picker-button-content">
                <DriveStatusMarker state={activeIndexedState} />
                <span className="drive-picker-button-label tnum">
                  <span>{displayLabel}</span>
                  {labelSpacer ? (
                    <span className="drive-picker-label-spacer" aria-hidden="true">{labelSpacer}</span>
                  ) : null}
                </span>
              </span>
            </PressButton>
          </TooltipWrapper>
          <div className="drive-picker-extend" inert={!expanded}>
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
              <div
                className="drive-picker-list"
                role="presentation"
                ref={listRef}
                data-window-drag-ignore={canDrag ? "true" : undefined}
                data-dragging={dragging ? "true" : undefined}
                {...dragHandlers}
                onPointerDownCapture={locationDrag.onPointerDownCapture}
                onClickCapture={(event) => {
                  locationDrag.onClickCapture(event);
                  if (!event.defaultPrevented) dragHandlers.onClickCapture(event);
                }}
              >
                {drives.map((drive) => {
                  const driveKey = normalizePath(drive);
                  const info = driveInfoMap.get(driveKey);
                  const indexedState = getDriveIndexState(info, indexedSearchState);
                  const driveLabel = formatDriveLabel(drive);
                  const isActive = driveKey === activeKey;
                  const tooltipText = buildDriveTooltip(driveLabel, info, indexedState === "checking" ? "Checking index" : undefined);
                  return (
                    <TooltipWrapper key={drive} text={tooltipText}>
                      <PressButton
                        type="button"
                        role="menuitem"
                        className={`drive-picker-item${isActive ? " is-active" : ""}`}
                        data-location-path={drive}
                        aria-label={buildDriveAriaLabel(driveLabel, indexedState)}
                        pressOnPointerDown={false}
                        onClick={() => onSelect(drive)}
                        onMouseDown={(event) => {
                          if (!onSelectNewTab) return;
                          handleMiddleClick(event, () => onSelectNewTab(drive));
                        }}
                      >
                        <span className="drive-picker-item-content">
                          <DriveStatusMarker state={indexedState} />
                          <span>{driveLabel}</span>
                        </span>
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
