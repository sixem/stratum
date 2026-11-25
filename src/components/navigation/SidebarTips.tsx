// Rotate sidebar tips and offer the same actions through the app context menu.
import { useId, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { RefreshIcon } from "@/components/icons";
import { PressButton } from "@/components/primitives/PressButton";
import { formatKeybind, getSessionHint, normalizeSidebarHiddenSections, refreshSessionHint, useSettingsStore } from "@/modules";
import type { ContextMenuItem } from "@/types";

type TipMenuEvent = MouseEvent | KeyboardEvent;

export type SidebarTipsProps = {
  onOpenMenu: (event: TipMenuEvent, items: ContextMenuItem[]) => void;
};

const hideTips = () => {
  const { sidebarHiddenSections, updateSettings } = useSettingsStore.getState();
  updateSettings({ sidebarHiddenSections: normalizeSidebarHiddenSections([...sidebarHiddenSections, "tips"]) });
};

export const SidebarTips = ({ onOpenMenu }: SidebarTipsProps) => {
  const [hint, setHint] = useState(getSessionHint);
  const keybinds = useSettingsStore((state) => state.keybinds);
  const headingId = useId();
  const contentId = useId();
  const binding = typeof hint.shortcut === "string" ? hint.shortcut : hint.shortcut && keybinds[hint.shortcut.action];
  const shortcut = binding ? formatKeybind(binding) : "";
  const nextTip = () => setHint(refreshSessionHint());
  const openMenu = (event: TipMenuEvent) => onOpenMenu(event, [
    { id: "sidebar-next-tip", label: "Next tip", icon: "refresh", onSelect: nextTip },
    { id: "sidebar-hide-tips", label: "Hide tips", icon: "hide", onSelect: hideTips },
  ]);

  return (
    <section className="sidebar-tips" aria-labelledby={headingId} onContextMenu={openMenu}>
      <div className="section-title" id={headingId}>Tips</div>
      <PressButton
        type="button"
        className="tip"
        aria-label="Show a new tip"
        aria-describedby={contentId}
        aria-keyshortcuts="Shift+F10"
        onClick={nextTip}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openMenu(event);
        }}
      >
        <span className="tip-content" id={contentId} aria-live="polite" aria-atomic="true">
          <span className="tip-title">{hint.title}</span>
          <span className="tip-text">{hint.text}</span>
          {shortcut ? <kbd className="tip-shortcut">{shortcut}</kbd> : null}
        </span>
        <RefreshIcon className="tip-next-icon" />
      </PressButton>
    </section>
  );
};
