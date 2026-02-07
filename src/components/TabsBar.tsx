// Tab strip for open folders with drag reordering.
import type { MouseEvent as ReactMouseEvent, PointerEvent } from "react";
import { Fragment, startTransition, useRef } from "react";
import { handleMiddleClick, tabLabel } from "@/lib";
import { useTabDragDrop } from "@/hooks";
import type { Tab } from "@/types";
import { PlusIcon, TabCloseIcon } from "./icons";
import { PressButton } from "./PressButton";
import { TooltipWrapper } from "./Tooltip";

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
}: TabItemProps) => {
  const label = tabLabel(tab.path);
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
      data-drop-kind="tab"
      data-drop-path={tab.path}
      data-drop-id={tab.id}
      data-drop-target={isDropTarget ? "true" : "false"}
      data-tab-id={tab.id}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".tab-close")) return;
        if (event.button === 0 && !isActive) {
          onSelect(tab.id);
        }
        onPointerDown(event, tab.id);
      }}
      onMouseDown={(event) => {
        handleMiddleClick(event, () => onClose(tab.id));
      }}
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

  return (
    <div className="tabsbar">
      <div
        className="tabs"
        data-fixed-tabs={fixedWidthTabs ? "true" : "false"}
        ref={tabsRef}
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
        <PressButton type="button" className="tab-new" onClick={onNew} aria-label="New tab">
          <PlusIcon className="tab-new-icon" />
        </PressButton>
      </div>
    </div>
  );
};
