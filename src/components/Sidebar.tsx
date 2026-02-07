// Sidebar for ordered sections like places, recent jumps, and tips.
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Fragment, useState } from "react";
import { handleMiddleClick, normalizePath, tabLabel } from "@/lib";
import type { SidebarSectionId } from "@/modules";
import {
  getSessionHint,
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
  refreshSessionHint,
} from "@/modules";
import { PressButton } from "./PressButton";
import { SidebarSection } from "./SidebarSection";
import type { Place } from "@/types";

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
};

type SidebarItemProps = {
  path: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  isDropTarget: boolean;
  isRecent?: boolean;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

const SidebarItem = ({
  path,
  title,
  subtitle,
  isActive,
  isDropTarget,
  isRecent = false,
  onSelect,
  onSelectNewTab,
}: SidebarItemProps) => {
  const handleMiddle = (event: ReactMouseEvent) => {
    if (!onSelectNewTab) return;
    handleMiddleClick(event, () => onSelectNewTab(path));
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <PressButton
      type="button"
      className={`place${isRecent ? " is-recent" : ""}${isActive ? " is-active" : ""}`}
      data-is-dir="true"
      data-path={path}
      data-drop-target={isDropTarget ? "true" : "false"}
      onClick={() => onSelect(path)}
      onMouseDown={handleMiddle}
      onContextMenu={handleContextMenu}
    >
      <span className="place-name">{title}</span>
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
                  onSelect={onSelect}
                  onSelectNewTab={onSelectNewTab}
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
      <div className="sidebar-content">
        {renderedSections.length === 0 ? (
          <div className="sidebar-empty">No sidebar sections visible.</div>
        ) : (
          renderedSections
        )}
      </div>
    </aside>
  );
};
