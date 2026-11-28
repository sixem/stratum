// Sidebar for ordered sections like places, recent jumps, and tips.
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Fragment, useRef, useState } from "react";
import { usePinnedPlaceDragDrop } from "@/hooks";
import { useLocationDrag } from "@/hooks/ui/inputs/useLocationDrag";
import { placeKey, type PlaceReference } from "@/lib/placeLocation";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { openRemotePlace, remotePlaceSubtitle } from "@/modules/remotePlaces";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { folderPathKey, handleMiddleClick, tabLabel } from "@/lib";
import type { PinShape, SidebarSectionId } from "@/modules";
import { normalizeSidebarHiddenSections, normalizeSidebarSectionOrder, useSettingsStore } from "@/modules";
import { PinShapeIcon } from "@/components/icons/PinShapeIcon";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { ScrollArea } from "@/components/primitives/ScrollArea";
import { SidebarSection } from "./SidebarSection";
import { SidebarTips, type SidebarTipsProps } from "./SidebarTips";
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
  onReorderPinnedPlace?: (fromPath: PlaceReference, toPath: PlaceReference, position: "before" | "after") => void;
  onPlaceContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onPlaceContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onRecentContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onRecentContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onOpenTipsMenu: SidebarTipsProps["onOpenMenu"];
};

type SidebarItemProps = {
  hostId?: string;
  reorderKey?: string;
  path: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  isDropTarget: boolean;
  isRecent?: boolean;
  isPinned?: boolean;
  pinColor?: string;
  pinShape?: PinShape;
  isDragging?: boolean;
  pinnedDropPosition?: "before" | "after" | null;
  onReorderPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, path: string) => void;
  onSuppressClick?: (event: ReactMouseEvent) => void;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
  onContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
};

const SidebarItem = ({
  hostId,
  reorderKey,
  path,
  title,
  subtitle,
  isActive,
  isDropTarget,
  isRecent = false,
  isPinned = false,
  pinColor,
  pinShape = "circle",
  isDragging = false,
  pinnedDropPosition = null,
  onReorderPointerDown,
  onSuppressClick,
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
  const menuTarget: PlaceContextTarget = { name: title, path, source, hostId };
  const canReorder = isPinned && !isRecent && Boolean(onReorderPointerDown);

  return (
    <PressButton
      type="button"
      className={`place${isRecent ? " is-recent" : ""}${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${canReorder ? " is-reorderable" : ""}`}
      data-pinned={isPinned ? "true" : "false"}
      data-place-kind={isPinned && !isRecent ? "pinned" : isRecent ? "recent" : "place"}
      data-context-place={source}
      data-context-name={title}
      data-place-host={hostId}
      data-place-key={reorderKey}
      data-remote-place-path={hostId ? path : undefined}
      data-is-dir={hostId ? undefined : "true"}
      data-path={hostId ? undefined : path}
      data-location-path={hostId || canReorder ? undefined : path}
      data-drop-target={isDropTarget ? "true" : "false"}
      data-pinned-drop={pinnedDropPosition ? "true" : "false"}
      data-pinned-drop-position={pinnedDropPosition ?? undefined}
      pressOnPointerDown={false}
      onClickCapture={onSuppressClick}
      onClick={() => onSelect(path)}
      onMouseDown={handleMiddle}
      onPointerDown={(event) => {
        if (event.button !== 2) return;
        onContextMenuDown?.(event, menuTarget);
      }}
      onPointerDownCapture={(event) => {
        if (!canReorder || event.button !== 0) return;
        if (reorderKey) onReorderPointerDown?.(event, reorderKey);
      }}
      draggable={false}
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
            <span className="place-pin" style={pinColor ? { color: pinColor } : undefined}>
              <PinShapeIcon shape={pinShape} />
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
  onReorderPinnedPlace,
  onPlaceContextMenu,
  onPlaceContextMenuDown,
  onRecentContextMenu,
  onRecentContextMenuDown,
  onOpenTipsMenu,
}: SidebarProps) => {
  const pinShape = useSettingsStore((state) => state.pinShape);
  const [placesOpen, setPlacesOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const placesListRef = useRef<HTMLDivElement | null>(null);
  const profiles = useRemoteHosts(state => state.profiles);
  const pane = useBottomPaneStore(state => state.active ? "bottom" : "main");
  const activeTab = getPaneSessionStore(pane)(state => state.tabs.find(tab => tab.id === state.activeTabId));
  const activeRemote = activeTab?.kind === "remote" ? activeTab.remote : undefined;
  const activeKey = activeRemote ? null : folderPathKey(pane === "bottom" ? activeTab?.path ?? "" : activePath);
  const dropTargetKey = dropTargetPath ? folderPathKey(dropTargetPath) : null;
  const orderedSections = normalizeSidebarSectionOrder(sectionOrder);
  const hiddenSectionIds = normalizeSidebarHiddenSections(hiddenSections);
  const hiddenSectionSet = new Set(hiddenSectionIds);
  const locationDrag = useLocationDrag();
  const { draggingPath, dropTarget, handlePointerDown, handleSuppressClick } =
    usePinnedPlaceDragDrop({
      onReorder: (fromPath, toPath, position) => {
        const from = places.find(place => placeKey(place) === fromPath);
        const to = places.find(place => placeKey(place) === toPath);
        if (from && to) onReorderPinnedPlace?.(from, to, position);
      },
      containerRef: placesListRef,
    });

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
              <div className="sidebar-places-list" ref={placesListRef}>
                {places.map((place) => {
                  const key = placeKey(place)!;
                  const remote = place.hostId ? { hostId: place.hostId, path: place.path } : undefined;
                  return (
                    <SidebarItem
                      key={key}
                      reorderKey={key}
                      hostId={place.hostId}
                      path={place.path}
                      title={place.name}
                      subtitle={remote ? remotePlaceSubtitle(place.path, profiles.find(profile => profile.id === remote.hostId)) : place.path}
                      isActive={remote ? activeRemote?.hostId === remote.hostId && activeRemote.path === remote.path : activeKey === folderPathKey(place.path)}
                      isDropTarget={!remote && dropTargetKey === folderPathKey(place.path)}
                      isPinned={place.pinned === true}
                      pinColor={place.pinColor}
                      pinShape={pinShape}
                      isDragging={draggingPath === key}
                      pinnedDropPosition={
                        dropTarget?.path === key ? dropTarget.position : null
                      }
                      onReorderPointerDown={
                        place.pinned === true && onReorderPinnedPlace
                          ? handlePointerDown
                          : undefined
                      }
                      onSuppressClick={
                        place.pinned === true && onReorderPinnedPlace
                          ? handleSuppressClick
                          : undefined
                      }
                      onSelect={remote ? () => openRemotePlace(remote, pane) : onSelect}
                      onSelectNewTab={remote ? () => openRemotePlace(remote, pane, true) : onSelectNewTab}
                      onContextMenu={onPlaceContextMenu}
                      onContextMenuDown={onPlaceContextMenuDown}
                    />
                  );
                })}
              </div>
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
                  isActive={activeKey === folderPathKey(path)}
                  isDropTarget={dropTargetKey === folderPathKey(path)}
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
        return <SidebarTips onOpenMenu={onOpenTipsMenu} />;
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
    <aside id="app-sidebar" className="sidebar" {...locationDrag}>
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
