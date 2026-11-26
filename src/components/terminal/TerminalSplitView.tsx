import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import type { Tab } from "@/types";
import type { LinkedPane } from "@/lib/paneLink";
import { clampTerminalSplit as clamp, TERMINAL_SPLIT_MIN as MIN, TERMINAL_SPLIT_MAX as MAX } from "@/lib/tabRestore";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { setTerminalSplitSize } from "@/modules/terminalSplit";
import { buildKeybindFromEvent, useIndexedSearchUiStore, usePromptStore, useSettingsStore } from "@/modules";
import { getTabShortcutDirection } from "@/modules/keybinds";
import { useQuickMoveSession } from "@/modules/quickMoveSession";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { getAdjacentTab } from "@/lib/tabs";
import { focusOtherFilePane } from "@/hooks/ui/inputs/focusOtherFilePane";
import { useTabWheelShortcuts } from "@/hooks/ui/inputs/useTabWheelShortcuts";
import { TerminalDirectoryBar } from "./TerminalDirectoryBar";
import { TerminalPane } from "./TerminalPane";
import "./terminalSplit.scss";

type SplitDividerProps = { firstPercent: number; stacked: boolean; save: (value: number) => void };
type SplitDrag = { position: number; span: number; start: number; value: number; pointer: number; frame: number | null };

function SplitDivider({ firstPercent, stacked, save }: SplitDividerProps) {
  const drag = useRef<SplitDrag | null>(null);
  const pointerPosition = (event: { clientX: number; clientY: number }) => stacked ? event.clientY : event.clientX;
  const readValue = (move: SplitDrag, position: number) =>
    clamp(move.start + 100 * (position - move.position) / move.span);
  const stopDrag = (el: HTMLDivElement, pointer: number, value: number) => {
    const move = drag.current;
    if (move?.pointer !== pointer) return;
    if (move.frame !== null) cancelAnimationFrame(move.frame);
    drag.current = null;
    el.style.removeProperty("--split-offset");
    el.removeAttribute("data-resizing");
    el.setAttribute("aria-valuenow", String(Math.round(value)));
  };
  useEffect(() => () => {
    if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame);
  }, []);
  return <div className="terminal-split-divider" role="separator" tabIndex={0}
    aria-label={stacked ? "Folder and PowerShell height" : "Folder and PowerShell width"}
    aria-orientation={stacked ? "horizontal" : "vertical"}
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={Math.round(firstPercent)}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      const el = event.currentTarget;
      const parent = el.parentElement;
      if (!parent) return;
      const span = stacked ? parent.clientHeight - el.offsetHeight : parent.clientWidth - el.offsetWidth;
      if (span <= 0) return;
      event.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(event.pointerId);
      el.setAttribute("data-resizing", "true");
      drag.current = { position: pointerPosition(event), span, start: firstPercent, value: firstPercent,
        pointer: event.pointerId, frame: null };
    }}
    onPointerMove={event => {
      const move = drag.current;
      if (move?.pointer !== event.pointerId) return;
      move.value = readValue(move, pointerPosition(event));
      if (move.frame !== null) return;
      const el = event.currentTarget;
      move.frame = requestAnimationFrame(() => {
        move.frame = null;
        el.style.setProperty("--split-offset", (move.value - move.start) * move.span / 100 + "px");
        el.setAttribute("aria-valuenow", String(Math.round(move.value)));
      });
    }}
    onPointerUp={event => {
      const move = drag.current;
      if (move?.pointer !== event.pointerId) return;
      const value = readValue(move, pointerPosition(event));
      stopDrag(event.currentTarget, event.pointerId, value);
      save(value);
    }}
    onLostPointerCapture={event => stopDrag(event.currentTarget, event.pointerId, firstPercent)}
    onPointerCancel={event => stopDrag(event.currentTarget, event.pointerId, firstPercent)}
    onKeyDown={event => {
      const move = drag.current;
      if (event.key === "Escape" && move) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.releasePointerCapture(move.pointer);
        stopDrag(event.currentTarget, move.pointer, firstPercent);
        return;
      }
      if (move || event.altKey || event.ctrlKey || event.metaKey) return;
      const values: Record<string, number> = {
        [stacked ? "ArrowUp" : "ArrowLeft"]: firstPercent - 5,
        [stacked ? "ArrowDown" : "ArrowRight"]: firstPercent + 5,
        Home: MIN,
        End: MAX,
      };
      if (!(event.key in values)) return;
      event.preventDefault();
      event.stopPropagation();
      save(clamp(values[event.key]));
    }} />;
}

type TerminalSplitViewProps = {
  pane: LinkedPane;
  tab?: Tab | null;
  filePaneRef: RefObject<HTMLElement | null>;
  onSelectTab: (id: string) => void;
  commandsBlocked: boolean;
  children: ReactNode;
};

export function TerminalSplitView({ pane, tab, filePaneRef, onSelectTab, commandsBlocked, children }: TerminalSplitViewProps) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const split = tab?.split;
  const folderPercent = split?.folderPercent ?? 50;
  const terminalFirst = split?.terminalFirst === true;
  const stacked = split?.stacked === true;
  // Keep the folder's share and both mounted surfaces when changing the grid areas.
  const firstPercent = terminalFirst ? 100 - folderPercent : folderPercent;
  const focusPane = () => setBottomPaneActive(pane === "bottom");
  const canUsePaneShortcuts = () => !commandsBlocked && !usePromptStore.getState().prompt &&
    !useIndexedSearchUiStore.getState().open && !useQuickMoveSession.getState().request;
  const switchTab = (direction: -1 | 1) => {
    const { tabs, activeTabId } = getPaneSessionStore(pane).getState();
    const target = getAdjacentTab(tabs, activeTabId, direction, useSettingsStore.getState().wrapTabNavigation);
    if (!target) return;
    // Retain focus in this pane if the active terminal is about to detach.
    const focused = document.activeElement;
    if (focused?.closest("[data-terminal]") && layoutRef.current?.contains(focused)) {
      filePaneRef.current?.focus({ preventScroll: true });
    }
    onSelectTab(target.id);
  };
  useTabWheelShortcuts(layoutRef, switchTab, canUsePaneShortcuts);

  const handleTerminalFocusKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Claim enabled navigation and focus shortcuts before xterm receives them.
    if (!(event.target instanceof Element) || !event.target.closest("[data-terminal]")) return;
    if (event.defaultPrevented || event.nativeEvent.isComposing || !canUsePaneShortcuts()) return;
    const { keybinds, terminalTabNavigation } = useSettingsStore.getState();
    const binding = buildKeybindFromEvent(event.nativeEvent);
    const direction = terminalTabNavigation ? getTabShortcutDirection(binding, keybinds) : null;
    if (direction !== null) {
      if (!event.repeat) switchTab(direction);
    } else if (event.ctrlKey && !event.altKey && !event.metaKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Preserve shell word movement for other shortcuts bound to these keys.
      return;
    } else if (binding === keybinds.focusOtherPane && useBottomPaneStore.getState().open) {
      if (!event.repeat && !focusOtherFilePane(pane)) return;
    } else if (split && binding === keybinds.focusSplitTerminal) {
      if (!event.repeat) filePaneRef.current?.focus({ preventScroll: true });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return <div ref={layoutRef} className="terminal-split-layout" data-paired={split ? "true" : undefined}
    onKeyDownCapture={tab?.terminal || split ? handleTerminalFocusKey : undefined}
    data-terminal-first={terminalFirst || undefined}
    data-stacked={stacked || undefined}
    style={split ? {
      "--split-first": firstPercent + "fr",
      "--split-second": (100 - firstPercent) + "fr",
    } as CSSProperties : undefined}>
    {children}
    {tab && split && <>
      <SplitDivider key={`${tab.id}:${stacked}`} firstPercent={firstPercent} stacked={stacked}
        save={value => setTerminalSplitSize(pane, tab.id, terminalFirst ? 100 - value : value)} />
      <div className="terminal-split-side" data-pane-path="" onFocusCapture={focusPane} onPointerDownCapture={focusPane}>
        <TerminalDirectoryBar directory={split.terminal.directory} />
        <TerminalPane terminal={split.terminal} autoFocus={false} />
      </div>
    </>}
  </div>;
}
