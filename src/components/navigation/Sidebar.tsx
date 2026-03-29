// Sidebar for ordered sections like places, recent jumps, and tips.
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Fragment, useState } from "react";
import { handleMiddleClick, normalizePath, tabLabel } from "@/lib";
import type { SidebarSectionId } from "@/modules";
import {
  getSessionHint,
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
  refreshSessionHint,
} from "@/modules";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PinIcon } from "@/components/icons";
import { PressButton } from "@/components/primitives/PressButton";
import { ScrollArea } from "@/components/primitives/ScrollArea";
import { SidebarSection } from "./SidebarSection";
import type { Place, PlaceContextTarget } from "@/types";

type SidebarProps = {
  places: Place[];
  recentJumps: string[];
  activePath: string;
  dropTargetPath?: string | null;
  sectionOrder: SidebarSectionId[];
  hiddenSections: SidebarSectionId[];
  onSelect: (path: string) => void;
  onSelectRecent: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
  onPlaceContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onPlaceContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onRecentContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onRecentContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
};

type SidebarItemProps = {
  path: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  isDropTarget: boolean;
  isRecent?: boolean;
  isPinned?: boolean;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
  onContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
};

const SidebarItem = ({
  path,
  title,
  subtitle,
  isActive,
  isDropTarget,
  isRecent = false,
  isPinned = false,
  onSelect,
  onSelectNewTab,
  onContextMenu,
  onContextMenuDown,
}: SidebarItemProps) => {
  const handleMiddle = (event: ReactMouseEvent) => {
    if (!onSelectNewTab) return;
    handleMiddleClick(event, () => onSelectNewTab(path));
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const source: PlaceContextTarget["source"] = isRecent ? "sidebar-recent" : "sidebar-place";
  const menuTarget: PlaceContextTarget = { name: title, path, source };

  return (
    <PressButton
      type="button"
      className={`place${isRecent ? " is-recent" : ""}${isActive ? " is-active" : ""}`}
      data-pinned={isPinned ? "true" : "false"}
      data-is-dir="true"
      data-path={path}
      data-drop-target={isDropTarget ? "true" : "false"}
      onClick={() => onSelect(path)}
      onMouseDown={handleMiddle}
      onPointerDown={(event) => {
        if (event.button !== 2) return;
        onContextMenuDown?.(event, menuTarget);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2) return;
        onContextMenu?.(event, menuTarget);
      }}
      onContextMenu={handleContextMenu}
    >
      <span className="place-head">
        <span className="place-name">{title}</span>
        {isPinned ? (
          <TooltipWrapper text="Pinned place">
            <span className="place-pin" aria-hidden="true">
              <PinIcon className="place-pin-icon" />
            </span>
          </TooltipWrapper>
        ) : null}
      </span>
      <span className="place-path">{subtitle}</span>
    </PressButton>
  );
};

export const Sidebar = ({
  places,
  recentJumps,
  activePath,
  dropTargetPath,
  sectionOrder,
  hiddenSections,
  onSelect,
  onSelectRecent,
  onSelectNewTab,
  onPlaceContextMenu,
  onPlaceContextMenuDown,
  onRecentContextMenu,
  onRecentContextMenuDown,
}: SidebarProps) => {
  const [placesOpen, setPlacesOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const activeKey = normalizePath(activePath);
  const dropTargetKey = dropTargetPath ? normalizePath(dropTargetPath) : null;
  const orderedSections = normalizeSidebarSectionOrder(sectionOrder);
  const hiddenSectionIds = normalizeSidebarHiddenSections(hiddenSections);
  const hiddenSectionSet = new Set(hiddenSectionIds);
  const [hint, setHint] = useState(() => getSessionHint());

  const renderSection = (sectionId: SidebarSectionId) => {
    switch (sectionId) {
      case "places":
        return (
          <SidebarSection
            title="Places"
            isOpen={placesOpen}
            onToggle={() => setPlacesOpen((value) => !value)}
          >
            {places.length === 0 ? (
              <div className="place is-empty">No places found</div>
            ) : (
              places.map((place) => (
                <SidebarItem
                  key={place.path}
                  path={place.path}
                  title={place.name}
                  subtitle={place.path}
                  isActive={activeKey === normalizePath(place.path)}
                  isDropTarget={dropTargetKey === normalizePath(place.path)}
                  isPinned={place.pinned === true}
                  onSelect={onSelect}
                  onSelectNewTab={onSelectNewTab}
                  onContextMenu={onPlaceContextMenu}
                  onContextMenuDown={onPlaceContextMenuDown}
                />
              ))
            )}
          </SidebarSection>
        );
      case "recent":
        return (
          <SidebarSection
            title="Recent jumps"
            isOpen={recentOpen}
            onToggle={() => setRecentOpen((value) => !value)}
          >
            {recentJumps.length === 0 ? (
              <div className="place is-empty">No jumps yet</div>
            ) : (
              recentJumps.map((path) => (
                <SidebarItem
                  key={path}
                  path={path}
                  title={tabLabel(path)}
                  subtitle={path}
                  isActive={activeKey === normalizePath(path)}
                  isDropTarget={dropTargetKey === normalizePath(path)}
                  isRecent
                  onSelect={onSelectRecent}
                  onSelectNewTab={onSelectNewTab}
                  onContextMenu={onRecentContextMenu}
                  onContextMenuDown={onRecentContextMenuDown}
                />
              ))
            )}
          </SidebarSection>
        );
      case "tips":
        return (
          <div className="sidebar-tips">
            <div className="section-title">Tips</div>
            <div className="tips">
              <PressButton
                type="button"
                className="tip"
                onClick={() => setHint(refreshSessionHint())}
                aria-label="Show a new tip"
              >
                {hint.text}
              </PressButton>
            </div>
          </div>
        );
      default:
        return null;
    }
  };
  // Build the visible section list so we can show a clean empty state when hidden.
  const renderedSections = orderedSections.reduce<ReactNode[]>((acc, sectionId) => {
    if (hiddenSectionSet.has(sectionId)) return acc;
    const content = renderSection(sectionId);
    if (!content) return acc;
    acc.push(<Fragment key={sectionId}>{content}</Fragment>);
    return acc;
  }, []);

  return (
    <aside className="sidebar">
      <ScrollArea
        className="sidebar-scroll"
        viewportClassName="sidebar-viewport"
        contentClassName="sidebar-content"
        scrollbarVariant="nav"
      >
        {renderedSections.length === 0 ? (
          <div className="sidebar-empty">No sidebar sections visible.</div>
        ) : (
          renderedSections
        )}
      </ScrollArea>
    </aside>
  );
};
