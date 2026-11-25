import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Tab } from "@/types";
import type { LinkedPane } from "@/lib/paneLink";
import { setBottomPaneActive } from "@/modules/bottomPaneStore";
import { setSplitWidth } from "@/modules/terminalSplit";
import { TerminalPane } from "./TerminalPane";
import "./terminalSplit.scss";

const MIN = 20;
const MAX = 80;
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, value));

function SplitDivider({ percent, save }: { percent: number; save: (value: number) => void }) {
  const drag = useRef<{ x: number; width: number; start: number; value: number; pointer: number; frame: number | null } | null>(null);
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
    aria-label="Folder and PowerShell width" aria-orientation="vertical"
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={Math.round(percent)}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      const el = event.currentTarget;
      const width = el.parentElement!.clientWidth;
      if (!width) return;
      event.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(event.pointerId);
      el.setAttribute("data-resizing", "true");
      drag.current = { x: event.clientX, width, start: percent, value: percent, pointer: event.pointerId, frame: null };
    }}
    onPointerMove={event => {
      const move = drag.current;
      if (move?.pointer !== event.pointerId) return;
      move.value = clamp(move.start + 100 * (event.clientX - move.x) / move.width);
      if (move.frame !== null) return;
      const el = event.currentTarget;
      move.frame = requestAnimationFrame(() => {
        move.frame = null;
        el.style.setProperty("--split-offset", (move.value - move.start) * move.width / 100 + "px");
        el.setAttribute("aria-valuenow", String(Math.round(move.value)));
      });
    }}
    onPointerUp={event => {
      const move = drag.current;
      if (move?.pointer !== event.pointerId) return;
      const value = clamp(move.start + 100 * (event.clientX - move.x) / move.width);
      stopDrag(event.currentTarget, event.pointerId, value);
      save(value);
    }}
    onLostPointerCapture={event => stopDrag(event.currentTarget, event.pointerId, percent)}
    onPointerCancel={event => stopDrag(event.currentTarget, event.pointerId, percent)}
    onKeyDown={event => {
      const move = drag.current;
      if (event.key === "Escape" && move) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.releasePointerCapture(move.pointer);
        stopDrag(event.currentTarget, move.pointer, percent);
        return;
      }
      if (move || event.altKey || event.ctrlKey || event.metaKey) return;
      const values: Record<string, number> = { ArrowLeft: percent - 5, ArrowRight: percent + 5, Home: MIN, End: MAX };
      if (!(event.key in values)) return;
      event.preventDefault();
      event.stopPropagation();
      save(clamp(values[event.key]));
    }} />;
}

export function TerminalSplitView({ pane, tab, children }: { pane: LinkedPane; tab?: Tab | null; children: ReactNode }) {
  const split = tab?.split;
  const focusPane = () => setBottomPaneActive(pane === "bottom");
  return <div className="terminal-split-layout" data-paired={split ? "true" : undefined}
    style={split ? { "--folder-width": split.folderPercent + "%" } as CSSProperties : undefined}>
    {children}
    {tab && split && <>
      <SplitDivider key={tab.id} percent={split.folderPercent} save={value => setSplitWidth(pane, tab.id, value)} />
      <div className="terminal-split-side" data-pane-path="" onFocusCapture={focusPane} onPointerDownCapture={focusPane}>
        <TerminalPane terminal={split.terminal} autoFocus={false} />
      </div>
    </>}
  </div>;
}
