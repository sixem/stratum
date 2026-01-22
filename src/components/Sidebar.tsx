// Sidebar for ordered sections like places, recent jumps, and tips.
import type { MouseEvent as ReactMouseEvent } from "react";
import { Fragment, useState } from "react";
import { handleMiddleClick, normalizePath, tabLabel } from "@/lib";
import type { SidebarSectionId } from "@/modules";
import { normalizeSidebarSectionOrder } from "@/modules";
import { TooltipWrapper } from "./Tooltip";
import { SidebarSection } from "./SidebarSection";
import type { Place } from "@/types";

type SidebarProps = {
  places: Place[];
  recentJumps: string[];
  activePath: string;
  sectionOrder: SidebarSectionId[];
  showTips: boolean;
  onSelect: (path: string) => void;
  onSelectRecent: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

type SidebarItemProps = {
  path: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  isRecent?: boolean;
  onSelect: (path: string) => void;
  onSelectNewTab?: (path: string) => void;
};

const SidebarItem = ({
  path,
  title,
  subtitle,
  isActive,
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
    <TooltipWrapper text={path}>
      <button
        type="button"
        className={`place${isRecent ? " is-recent" : ""}${isActive ? " is-active" : ""}`}
        onClick={() => onSelect(path)}
        onMouseDown={handleMiddle}
        onContextMenu={handleContextMenu}
      >
        <span className="place-name">{title}</span>
        <span className="place-path">{subtitle}</span>
      </button>
    </TooltipWrapper>
  );
};

export function Sidebar({
  places,
  recentJumps,
  activePath,
  sectionOrder,
  showTips,
  onSelect,
  onSelectRecent,
  onSelectNewTab,
}: SidebarProps) {
  const [placesOpen, setPlacesOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const activeKey = normalizePath(activePath);
  const orderedSections = normalizeSidebarSectionOrder(sectionOrder);

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
                  isRecent
                  onSelect={onSelectRecent}
                  onSelectNewTab={onSelectNewTab}
                />
              ))
            )}
          </SidebarSection>
        );
      case "tips":
        if (!showTips) return null;
        return (
          <div className="sidebar-tips">
            <div className="section-title">Tips</div>
            <div className="tips">
              <div className="tip">Click a folder row to open it.</div>
              <div className="tip">Use the path bar to jump anywhere.</div>
              <div className="tip">Refresh to rescan the folder.</div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-content">
        {orderedSections.map((sectionId) => {
          const content = renderSection(sectionId);
          if (!content) return null;
          return <Fragment key={sectionId}>{content}</Fragment>;
        })}
      </div>
    </aside>
  );
}
