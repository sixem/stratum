// Tab strip for open folders with drag reordering.
import type { MouseEvent as ReactMouseEvent, PointerEvent } from "react";
import {
  Fragment,
  startTransition,
  useEffect,
  useRef,
} from "react";
import { handleMiddleClick, tabLabel } from "@/lib";
import { useHorizontalOverflowScroll, useTabDragDrop } from "@/hooks";
import type { PlaceContextTarget, Tab } from "@/types";
import { PlusIcon, TabCloseIcon } from "@/components/icons";
import { HorizontalChevronButton, PressButton } from "@/components/primitives";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type TabsBarProps = {
  tabs: Tab[];
  activeId: string | null;
  dropTargetId?: string | null;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (fromId: string, toIndex: number) => void;
  onTabContextMenu?: (event: PointerEvent<HTMLDivElement>, target: PlaceContextTarget) => void;
  onTabContextMenuDown?: (
    event: PointerEvent<HTMLDivElement>,
    target: PlaceContextTarget,
  ) => void;
};

type TabItemProps = {
  tab: Tab;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onSuppressClick: (event: ReactMouseEvent) => void;
  isDragging: boolean;
  isDropTarget: boolean;
  index: number;
  showIndex: boolean;
  showClose: boolean;
  fixedWidthTabs: boolean;
  onContextMenu?: (event: PointerEvent<HTMLDivElement>, target: PlaceContextTarget) => void;
  onContextMenuDown?: (
    event: PointerEvent<HTMLDivElement>,
    target: PlaceContextTarget,
  ) => void;
};

const TabItem = ({
  tab,
  isActive,
  onSelect,
  onClose,
  onPointerDown,
  onSuppressClick,
  isDragging,
  isDropTarget,
  index,
  showIndex,
  showClose,
  fixedWidthTabs,
  onContextMenu,
  onContextMenuDown,
}: TabItemProps) => {
  const label = tabLabel(tab.path);
  const isUntitled = tab.path.trim().length === 0;
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${isUntitled ? " is-untitled" : ""}`}
      data-drop-kind="tab"
      data-drop-path={tab.path}
      data-drop-id={tab.id}
      data-drop-target={isDropTarget ? "true" : "false"}
      data-tab-id={tab.id}
      data-tab-kind={isUntitled ? "untitled" : "directory"}
      onPointerDown={(event) => {
        if (event.button === 2 && !isUntitled) {
          onContextMenuDown?.(event, {
            name: label,
            path: tab.path,
            source: "tab",
          });
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".tab-close")) return;
        if (event.button === 0 && !isActive) {
          onSelect(tab.id);
        }
        onPointerDown(event, tab.id);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2 || isUntitled) return;
        onContextMenu?.(event, {
          name: label,
          path: tab.path,
          source: "tab",
        });
      }}
      onMouseDown={(event) => {
        handleMiddleClick(event, () => onClose(tab.id));
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <TooltipWrapper text={tab.path}>
        <button
          type="button"
          className="tab-main"
          onClickCapture={onSuppressClick}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            if (isActive) return;
            onSelect(tab.id);
          }}
        >
          {showIndex ? <span className="tab-index">{index + 1}</span> : null}
          <span className="tab-title">{label}</span>
        </button>
      </TooltipWrapper>
      {showClose ? (
        <PressButton
          type="button"
          className="tab-close"
          onClick={() => {
            startTransition(() => onClose(tab.id));
          }}
          aria-label={`Close ${label} tab`}
        >
          <TabCloseIcon className="tab-close-icon" />
        </PressButton>
      ) : fixedWidthTabs ? (
        <span className="tab-close-spacer" aria-hidden="true" />
      ) : null}
    </div>
  );
};

export const TabsBar = ({
  tabs,
  activeId,
  dropTargetId,
  showTabNumbers,
  fixedWidthTabs,
  onSelect,
  onClose,
  onNew,
  onReorder,
  onTabContextMenu,
  onTabContextMenuDown,
}: TabsBarProps) => {
  // Container ref lets the reorder hook measure tab positions.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const {
    draggingId,
    dropIndex,
    dropIndicatorX,
    handlePointerDown,
    handleSuppressClick,
  } = useTabDragDrop({
    onReorder,
    containerRef: tabsRef,
  });
  const { canScrollLeft, canScrollRight, overflowed, scrollByDirection, updateScrollState } =
    useHorizontalOverflowScroll(tabsRef, {
      observeSelector: ".tab[data-tab-id]",
      refreshKey: tabs,
    });

  useEffect(() => {
    if (!activeId) return;
    const tabsEl = tabsRef.current;
    if (!tabsEl) return;
    const activeTab = Array.from(
      tabsEl.querySelectorAll<HTMLElement>(".tab[data-tab-id]"),
    ).find((tab) => tab.dataset.tabId === activeId);
    if (!activeTab) return;
    // Keep the active tab visible when tab count exceeds strip width.
    activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    updateScrollState();
  }, [activeId, tabs.length, updateScrollState]);

  return (
    <div className="tabsbar">
      <div
        className="tabs-scroll-wrap"
        data-overflowed={overflowed ? "true" : "false"}
      >
        <HorizontalChevronButton
          type="button"
          className="tab-scroll-button is-left"
          iconClassName="tab-scroll-chevron"
          direction="left"
          onClick={() => scrollByDirection("left")}
          aria-label="Scroll tabs left"
          disabled={!canScrollLeft}
        />
        <div
          className="tabs"
          data-fixed-tabs={fixedWidthTabs ? "true" : "false"}
          ref={tabsRef}
          onWheel={(event) => {
            const tabsEl = tabsRef.current;
            if (!tabsEl || !overflowed) return;
            // Map mouse-wheel vertical deltas to horizontal tab scrolling.
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            tabsEl.scrollBy({ left: event.deltaY });
            event.preventDefault();
          }}
        >
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              <TabItem
                tab={tab}
                isActive={tab.id === activeId}
                onSelect={onSelect}
                onClose={onClose}
                onPointerDown={handlePointerDown}
                onSuppressClick={handleSuppressClick}
                isDragging={draggingId === tab.id}
                isDropTarget={dropTargetId === tab.id}
                index={index}
                showIndex={showTabNumbers}
                showClose={tab.id === activeId}
                fixedWidthTabs={fixedWidthTabs}
                onContextMenu={onTabContextMenu}
                onContextMenuDown={onTabContextMenuDown}
              />
            </Fragment>
          ))}
          {dropIndex != null && dropIndicatorX != null ? (
            <div
              className="tab-drop-indicator"
              style={{ left: `${dropIndicatorX}px` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <HorizontalChevronButton
          type="button"
          className="tab-scroll-button is-right"
          iconClassName="tab-scroll-chevron"
          direction="right"
          onClick={() => scrollByDirection("right")}
          aria-label="Scroll tabs right"
          disabled={!canScrollRight}
        />
      </div>
      <PressButton type="button" className="tab-new" onClick={onNew} aria-label="New tab">
        <PlusIcon className="tab-new-icon" />
      </PressButton>
    </div>
  );
};
