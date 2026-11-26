// Tab strip for open folders with drag reordering and pane moves.
import { FolderNetworkIcon } from "@/components/icons/FolderNetworkIcon";
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
import { cancelSplitPicker, canPairFolder, pairWithFolder, useSplitPicker } from "@/modules/terminalSplit";
import { useRemoteHosts } from "@/modules/remoteHosts";
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
  remoteHost?: string;
  choosing: boolean;
  onPick?: () => void;
  tab: Tab;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, id: string, anchored: boolean) => void;
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
  choosing,
  remoteHost,
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
  onContextMenu,
  onContextMenuDown,
}: TabItemProps) => {
  const location = tab.terminal?.directory.trim() ?? tab.path;
  const remote = tab.kind === "remote" ? tab.remote : null;
  const label = remote ? remote.path.split("/").filter(Boolean).pop() || "/" : tab.terminal && !location ? "PowerShell" : tabLabel(location) || location;
  const isUntitled = tab.kind === "folder" && tab.path.trim().length === 0;
  const menuTarget: PlaceContextTarget = { name: label, path: tab.path, source: "tab", tabId: tab.id };
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${isUntitled ? " is-untitled" : ""}`}
      data-drop-kind={tab.kind === "folder" ? "tab" : undefined}
      data-drop-path={tab.path}
      data-drop-id={tab.id}
      data-drop-target={isDropTarget ? "true" : "false"}
      data-tab-id={tab.id}
      data-tab-anchored={tab.anchored ? "true" : undefined}
      data-split-target={onPick ? "true" : undefined}
      data-context-place="tab"
      data-context-name={label}
      data-tab-kind={remote ? "remote" : tab.terminal ? "powershell" : isUntitled ? "untitled" : "directory"}
      onPointerDown={(event) => {
        if (choosing && event.button === 0) {
          event.stopPropagation();
          return;
        }
        if (event.button === 2) {
          onContextMenuDown?.(event, menuTarget);
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".tab-close")) return;
        if (event.button === 0 && !isActive) {
          if (tab.terminal) event.preventDefault();
          onSelect(tab.id);
        }
        onPointerDown(event, tab.id, tab.anchored === true);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2) return;
        onContextMenu?.(event, menuTarget);
      }}
      onMouseDown={(event) => {
        handleMiddleClick(event, () => { if (!tab.anchored) onClose(tab.id); });
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <TooltipWrapper text={remote ? `${remoteHost ?? "Remote"} · ${remote.path}` : location}>
        <button
          type="button"
          className="tab-main"
          aria-label={tab.anchored ? `${label}, anchored` : undefined}
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
          {remote && <FolderNetworkIcon />}
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
      ) : fixedWidthTabs && !tab.anchored ? (
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
  // Container ref lets the reorder hook measure tab positions.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const profiles = useRemoteHosts(state => state.profiles);
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

  const activeIndex = tabs.findIndex(tab => tab.id === activeId);
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
  }, [activeId, activeIndex, tabs.length, updateScrollState]);

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
                remoteHost={tab.kind === "remote" ? profiles.find(profile => profile.id === tab.remote.hostId)?.name : undefined}
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
                showClose={!tab.anchored && tab.id === activeId}
                fixedWidthTabs={fixedWidthTabs}
                onContextMenu={onTabContextMenu}
                onContextMenuDown={onTabContextMenuDown}
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
