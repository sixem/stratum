// Tab strip for open folders with drag reordering and pane moves.
import { SquareTerminalIcon } from "@/components/icons/SquareTerminalIcon";
import type { MouseEvent as ReactMouseEvent, PointerEvent, ReactNode } from "react";
import {
  Fragment,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DropTarget, TabDropSubmenuState } from "@/lib";
import { handleMiddleClick, tabLabel } from "@/lib";
import { registerTabLocationDrop } from "@/lib/tabLocationDrop";
import { useHorizontalOverflowScroll, useTabDragDrop } from "@/hooks";
import { DropTargetSubmenu } from "@/components/overlay/DropTargetSubmenu";
import type { ContextMenuItem, PlaceContextTarget, Tab } from "@/types";
import type { TabTransfer } from "@/types/tabs";
import { PlusIcon, TabCloseIcon } from "@/components/icons";
import { HorizontalChevronButton, PressButton } from "@/components/primitives";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { formatKeybind, useSettingsStore } from "@/modules";
import { getDefaultTabGridSize } from "@/modules/tabGridSize";
import { cancelSplitPicker, canPairFolder, pairWithFolder, useSplitPicker } from "@/modules/terminalSplit";
import type { LinkedPane } from "@/lib/paneLink";

type TabsBarProps = {
  pane?: LinkedPane;
  leading?: ReactNode;
  tabs: Tab[];
  activeId: string | null;
  dropTargetId?: string | null;
  dropTargetPath?: string | null;
  tabDropSubmenu?: TabDropSubmenuState;
  dragPoint?: { x: number; y: number } | null;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onNewPowerShell: () => void;
  onOpenLocation: (path: string) => void;
  onReorder: (fromId: string, toIndex: number) => void;
  onMoveTab: (id: string, receive: (transfer: TabTransfer) => boolean) => void;
  onReceiveTab: (transfer: TabTransfer, toIndex: number) => boolean;
  onSubmenuHoverTargetChange?: (target: DropTarget | null) => void;
  onSubmenuCloseRequest?: () => void;
  onStripContextMenu: (event: ReactMouseEvent<HTMLDivElement>, items: ContextMenuItem[]) => void;
  onTabContextMenu?: (event: PointerEvent<HTMLDivElement>, target: PlaceContextTarget) => void;
  onTabContextMenuDown?: (
    event: PointerEvent<HTMLDivElement>,
    target: PlaceContextTarget,
  ) => void;
};

type TabItemProps = {
  choosing: boolean;
  onPick?: () => void;
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
  untitledMenu: boolean;
  onContextMenu?: (event: PointerEvent<HTMLDivElement>, target: PlaceContextTarget) => void;
  onContextMenuDown?: (
    event: PointerEvent<HTMLDivElement>,
    target: PlaceContextTarget,
  ) => void;
};

const TabItem = ({
  choosing,
  onPick,
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
  untitledMenu,
  onContextMenu,
  onContextMenuDown,
}: TabItemProps) => {
  const label = tab.terminal ? "PowerShell" : tabLabel(tab.path);
  const isUntitled = !tab.terminal && tab.path.trim().length === 0;
  const hasMenu = !isUntitled || untitledMenu;
  const menuTarget: PlaceContextTarget = { name: label, path: tab.path, source: "tab", tabId: tab.id };
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${isUntitled ? " is-untitled" : ""}`}
      data-drop-kind={tab.terminal ? undefined : "tab"}
      data-drop-path={tab.path}
      data-drop-id={tab.id}
      data-drop-target={isDropTarget ? "true" : "false"}
      data-tab-id={tab.id}
      data-split-target={onPick ? "true" : undefined}
      data-context-place="tab"
      data-context-name={label}
      data-tab-kind={tab.terminal ? "powershell" : isUntitled ? "untitled" : "directory"}
      onPointerDown={(event) => {
        if (choosing && event.button === 0) {
          event.stopPropagation();
          return;
        }
        if (event.button === 2 && hasMenu) {
          onContextMenuDown?.(event, menuTarget);
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".tab-close")) return;
        if (event.button === 0 && !isActive) {
          if (tab.terminal) event.preventDefault();
          onSelect(tab.id);
        }
        onPointerDown(event, tab.id);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2 || !hasMenu) return;
        onContextMenu?.(event, menuTarget);
      }}
      onMouseDown={(event) => {
        handleMiddleClick(event, () => onClose(tab.id));
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <TooltipWrapper text={tab.terminal?.directory || tab.path}>
        <button
          type="button"
          className="tab-main"
          onClickCapture={event => {
            if (!choosing) return onSuppressClick(event);
            event.preventDefault();
            event.stopPropagation();
            onPick?.();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            if (choosing) { onPick?.(); return; }
            if (isActive) return;
            onSelect(tab.id);
          }}
        >
          {showIndex ? <span className="tab-index">{index + 1}</span> : null}
          {(tab.terminal || tab.split) && <SquareTerminalIcon />}
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
  pane = "main",
  leading,
  tabs,
  activeId,
  dropTargetId,
  dropTargetPath,
  tabDropSubmenu,
  dragPoint,
  showTabNumbers,
  fixedWidthTabs,
  onSelect,
  onClose,
  onNew,
  onNewPowerShell,
  onOpenLocation,
  onReorder,
  onMoveTab,
  onReceiveTab,
  onSubmenuHoverTargetChange,
  onSubmenuCloseRequest,
  onStripContextMenu,
  onTabContextMenu,
  onTabContextMenuDown,
}: TabsBarProps) => {
  const untitledMenu = useSettingsStore(state => Boolean(getDefaultTabGridSize(state)));
  // Container ref lets the reorder hook measure tab positions.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const source = useSplitPicker(state => state.source);
  const sourceStillOpen = source?.pane === pane && tabs.some(tab => tab.id === source.id && tab.terminal?.key === source.key);
  useEffect(() => {
    if (source?.pane !== pane) return;
    if (!sourceStillOpen) { cancelSplitPicker(); return; }
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelSplitPicker();
      tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(source.id)}"] .tab-main`)?.focus();
    };
    const cancelOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) ||
          !event.target.closest('[data-split-target], .tab-scroll-button')) cancelSplitPicker();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("pointerdown", cancelOutside, true);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("pointerdown", cancelOutside, true);
      if (useSplitPicker.getState().source === source) cancelSplitPicker();
    };
  }, [pane, source, sourceStillOpen]);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [submenuAnchorElement, setSubmenuAnchorElement] = useState<HTMLElement | null>(null);
  const {
    draggingId,
    dropIndicatorX,
    receivingTab,
    handlePointerDown,
    handleSuppressClick,
  } = useTabDragDrop({
    containerRef: tabsRef,
    stripRef,
    onReorder,
    onMoveTab,
    onReceiveTab,
  });
  const { canScrollLeft, canScrollRight, overflowed, scrollByDirection, updateScrollState } =
    useHorizontalOverflowScroll(tabsRef, {
      observeSelector: ".tab[data-tab-id]",
      refreshKey: tabs,
    });

  useLayoutEffect(() => {
    if (stripRef.current) return registerTabLocationDrop(stripRef.current, onOpenLocation);
  }, [onOpenLocation]);

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

  useLayoutEffect(() => {
    const hostTabId = tabDropSubmenu?.hostTabId ?? null;
    if (!hostTabId) {
      setSubmenuAnchorElement(null);
      return;
    }
    const tabsEl = tabsRef.current;
    if (!tabsEl) {
      setSubmenuAnchorElement(null);
      return;
    }
    const nextAnchor =
      Array.from(tabsEl.querySelectorAll<HTMLElement>(".tab[data-tab-id]")).find(
        (tab) => tab.dataset.tabId === hostTabId,
      ) ?? null;
    setSubmenuAnchorElement((previous) => (previous === nextAnchor ? previous : nextAnchor));
  }, [tabDropSubmenu?.hostTabId, tabs]);

  return (
    <div className="tabsbar" data-tab-location-strip="true" data-tab-transfer-hover={receivingTab || undefined} ref={stripRef}
      onContextMenu={event => {
        const target = event.target;
        if (event.defaultPrevented || !(target instanceof Element) ||
            (target !== event.currentTarget && !target.matches(".tabs, .tabs-scroll-wrap"))) return;
        onStripContextMenu(event, [
          { id: "strip-new-tab", label: "New tab", icon: "add", onSelect: onNew,
            hint: formatKeybind(useSettingsStore.getState().keybinds.newTab) || undefined },
          { id: "strip-new-shell", label: "New PowerShell tab", icon: "terminal", onSelect: onNewPowerShell },
        ]);
      }}>
      {leading}
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
        >
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              <TabItem
                choosing={Boolean(source)}
                onPick={source && canPairFolder(tab) ? () => pairWithFolder(pane, tab.id, onSelect) : undefined}
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
                untitledMenu={untitledMenu}
              />
            </Fragment>
          ))}
          {dropIndicatorX != null ? (
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
      <TooltipWrapper text="New PowerShell tab">
        <PressButton type="button" className="tab-new" aria-label="New PowerShell tab"
          pressOnPointerDown={false} onClick={onNewPowerShell}>
          <SquareTerminalIcon />
        </PressButton>
      </TooltipWrapper>
      <DropTargetSubmenu
        open={Boolean(submenuAnchorElement && tabDropSubmenu?.hostTabId && (tabDropSubmenu.loading || tabDropSubmenu.items.length > 0))}
        anchorElement={submenuAnchorElement}
        scrollElement={tabsRef.current}
        hostTabId={tabDropSubmenu?.hostTabId ?? null}
        hostPath={tabDropSubmenu?.hostPath ?? null}
        items={tabDropSubmenu?.items ?? []}
        loading={tabDropSubmenu?.loading ?? false}
        activePath={dropTargetPath}
        dragPoint={dragPoint}
        onHoverTargetChange={onSubmenuHoverTargetChange}
        onRequestClose={onSubmenuCloseRequest}
      />
    </div>
  );
};
