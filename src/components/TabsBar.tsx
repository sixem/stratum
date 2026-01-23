// Tab strip for open folders with drag reordering.
import type { DragEvent } from "react";
import { Fragment, startTransition } from "react";
import { handleMiddleClick, tabLabel } from "@/lib";
import { useTabDragDrop } from "@/hooks";
import type { Tab } from "@/types";
import { TabCloseIcon } from "./Icons";
import { TooltipWrapper } from "./Tooltip";

type TabsBarProps = {
  tabs: Tab[];
  activeId: string | null;
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
  canClose: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  index: number;
  showIndex: boolean;
  showClose: boolean;
  fixedWidthTabs: boolean;
};

const TabItem = ({
  tab,
  isActive,
  canClose,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
  index,
  showIndex,
  showClose,
  fixedWidthTabs,
}: TabItemProps) => {
  const label = tabLabel(tab.path);
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, tab.id)}
      onDragOver={(event) => onDragOver(event, index)}
      onDragEnd={onDragEnd}
      onMouseDown={(event) => {
        if (!canClose) return;
        handleMiddleClick(event, () => onClose(tab.id));
      }}
    >
      <TooltipWrapper text={tab.path}>
        <button
          type="button"
          className="tab-main"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            if (isActive) return;
            // Defer the state change so the mousedown handler stays light.
            event.preventDefault();
            window.requestAnimationFrame(() => {
              startTransition(() => onSelect(tab.id));
            });
          }}
          onClick={(event) => {
            // Keep keyboard activation working without double-triggering.
            if (event.detail !== 0) return;
            if (isActive) return;
            startTransition(() => onSelect(tab.id));
          }}
        >
          {showIndex ? <span className="tab-index">{index + 1}</span> : null}
          <span className="tab-title">{label}</span>
        </button>
      </TooltipWrapper>
      {showClose ? (
        <button
          type="button"
          className="tab-close"
          onClick={() => {
            startTransition(() => onClose(tab.id));
          }}
          aria-label={`Close ${label} tab`}
          disabled={!canClose}
        >
          <TabCloseIcon className="tab-close-icon" />
        </button>
      ) : fixedWidthTabs ? (
        <span className="tab-close-spacer" aria-hidden="true" />
      ) : null}
    </div>
  );
};

const TabDrop = () => <div className="tab-drop" />;

export function TabsBar({
  tabs,
  activeId,
  showTabNumbers,
  fixedWidthTabs,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: TabsBarProps) {
  const canClose = tabs.length > 1;
  const {
    draggingId,
    dropIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleContainerDragOver,
  } = useTabDragDrop({
    tabCount: tabs.length,
    onReorder,
  });

  return (
    <div className="tabsbar">
      <div
        className="tabs"
        data-fixed-tabs={fixedWidthTabs ? "true" : "false"}
        onDrop={handleDrop}
        onDragOver={handleContainerDragOver}
      >
        {tabs.map((tab, index) => (
          <Fragment key={tab.id}>
            {dropIndex === index ? <TabDrop /> : null}
            <TabItem
              tab={tab}
              isActive={tab.id === activeId}
              canClose={canClose}
              onSelect={onSelect}
              onClose={onClose}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragging={draggingId === tab.id}
              index={index}
              showIndex={showTabNumbers}
              showClose={tab.id === activeId}
              fixedWidthTabs={fixedWidthTabs}
            />
          </Fragment>
        ))}
        {dropIndex === tabs.length ? <TabDrop /> : null}
        <button type="button" className="tab-new" onClick={onNew} aria-label="New tab">
          +
        </button>
      </div>
    </div>
  );
}
