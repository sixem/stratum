import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import type { Tab } from "@/types";
import type { LinkedPane } from "@/lib/paneLink";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { setTerminalSplitSize } from "@/modules/terminalSplit";
import { buildKeybindFromEvent, useIndexedSearchUiStore, usePromptStore, useSettingsStore } from "@/modules";
import { useQuickMoveSession } from "@/modules/quickMoveSession";
import { focusOtherFilePane } from "@/hooks/ui/inputs/focusOtherFilePane";
import { TerminalPane } from "./TerminalPane";
import "./terminalSplit.scss";

const MIN = 20;
const MAX = 80;
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, value));

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
  commandsBlocked: boolean;
  children: ReactNode;
};

export function TerminalSplitView({ pane, tab, filePaneRef, commandsBlocked, children }: TerminalSplitViewProps) {
  const split = tab?.split;
  const folderPercent = split?.folderPercent ?? 50;
  const terminalFirst = split?.terminalFirst === true;
  const stacked = split?.stacked === true;
  // Keep the folder's share and both mounted surfaces when changing the grid areas.
  const firstPercent = terminalFirst ? 100 - folderPercent : folderPercent;
  const focusPane = () => setBottomPaneActive(pane === "bottom");
  const handleTerminalFocusKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Claim focus shortcuts before xterm receives them as shell input.
    if (!(event.target instanceof Element) || !event.target.closest("[data-terminal]")) return;
    const { keybinds } = useSettingsStore.getState();
    if ((!keybinds.focusOtherPane && !keybinds.focusSplitTerminal) ||
        event.defaultPrevented || event.nativeEvent.isComposing || commandsBlocked ||
        usePromptStore.getState().prompt || useIndexedSearchUiStore.getState().open ||
        useQuickMoveSession.getState().request) return;
    const binding = buildKeybindFromEvent(event.nativeEvent);
    if (binding === keybinds.focusOtherPane && useBottomPaneStore.getState().open) {
      if (!event.repeat && !focusOtherFilePane(pane)) return;
    } else if (split && binding === keybinds.focusSplitTerminal) {
      if (!event.repeat) filePaneRef.current?.focus({ preventScroll: true });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return <div className="terminal-split-layout" data-paired={split ? "true" : undefined}
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
        <TerminalPane terminal={split.terminal} autoFocus={false} />
      </div>
    </>}
  </div>;
}
