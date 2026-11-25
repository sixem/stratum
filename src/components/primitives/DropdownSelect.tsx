// Reusable themed dropdown built on a button + listbox.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@/components/icons";
import {
  clampOverlayStart,
  resolvePopoverVerticalPlacement,
} from "@/components/overlay/overlayUtils";
import { useOverlayAutoUpdate } from "@/components/overlay/useOverlayAutoUpdate";
import { useOverlayDismiss } from "@/components/overlay/useOverlayDismiss";
import { PressButton } from "./PressButton";

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type DropdownGroup = {
  id: string;
  label?: string;
  options: DropdownOption[];
};

type DropdownSelectProps = {
  value: string | null;
  groups: DropdownGroup[];
  placeholder?: string;
  onChange: (next: string | null) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
};

type MenuOption = Omit<DropdownOption, "value"> & {
  value: string | null;
  index: number;
};

const MENU_EDGE = 8;
const MENU_GAP = 6;
const MENU_MIN_HEIGHT = 120;
const POSITION_EPSILON_PX = 0.5;

const getNextEnabledIndex = (
  options: readonly MenuOption[],
  startIndex: number,
  direction: 1 | -1,
): number => {
  if (options.length === 0) return -1;
  let index = startIndex;
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
  }
  return -1;
};

export const DropdownSelect = ({
  value,
  groups,
  placeholder,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  menuClassName,
}: DropdownSelectProps) => {
  const controlId = useId();
  const listId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const followupPositionFrameRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuReady, setMenuReady] = useState(false);
  const [highlight, setHighlight] = useState<{ option: MenuOption; keyboard: boolean } | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    dropUp: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 260,
    dropUp: false,
  });

  const { options, menuGroups, clearOption } = useMemo(() => {
    const options: MenuOption[] = [];
    // A caller-provided placeholder labels the selectable empty value.
    const clearOption = placeholder === undefined ? null : { value: null, label: placeholder, index: 0 };
    if (clearOption) options.push(clearOption);
    const menuGroups = groups.map((group) => ({
      ...group,
      options: group.options.map((option) => {
        const entry = { ...option, index: options.length };
        options.push(entry);
        return entry;
      }),
    }));
    return { options, menuGroups, clearOption };
  }, [groups, placeholder]);
  const selectedOption = options.find((option) => option.value === value);
  const highlightedOption = highlight && options[highlight.option.index] === highlight.option
    ? highlight.option : null;
  const activeOption = highlightedOption ?? (selectedOption && !selectedOption.disabled
    ? selectedOption : options.find((option) => !option.disabled));
  const activeDescendantId = open && activeOption ? `${listId}-option-${activeOption.index}` : undefined;

  const openMenu = useCallback(() => {
    setMenuReady(false);
    setOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuReady(false);
    setHighlight(null);
  }, []);

  const dismissOnEscape = useCallback((event: KeyboardEvent) => {
    const { target } = event;
    if (target instanceof Node && (rootRef.current?.contains(target) || menuRef.current?.contains(target))) {
      event.preventDefault();
    }
    closeMenu();
  }, [closeMenu]);

  useOverlayDismiss({
    enabled: open,
    refs: [rootRef, menuRef],
    onEscape: dismissOnEscape,
    onPointerDownOutside: closeMenu,
    keydownCapture: true,
    pointerDownCapture: true,
  });

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const measuredHeight = menuRef.current?.offsetHeight ?? 260;
    const { dropUp, maxHeight, top } = resolvePopoverVerticalPlacement({
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      overlayHeight: measuredHeight,
      viewportHeight,
      edge: MENU_EDGE,
      gap: MENU_GAP,
      minHeight: MENU_MIN_HEIGHT,
    });
    const left = clampOverlayStart(rect.left, rect.width, viewportWidth, MENU_EDGE);
    setMenuPosition((previous) => {
      const topChanged = Math.abs(previous.top - top) > POSITION_EPSILON_PX;
      const leftChanged = Math.abs(previous.left - left) > POSITION_EPSILON_PX;
      const widthChanged = Math.abs(previous.width - rect.width) > POSITION_EPSILON_PX;
      const maxHeightChanged = Math.abs(previous.maxHeight - maxHeight) > POSITION_EPSILON_PX;
      if (!topChanged && !leftChanged && !widthChanged && !maxHeightChanged && previous.dropUp === dropUp) {
        return previous;
      }
      return {
        top,
        left,
        width: rect.width,
        maxHeight,
        dropUp,
      };
    });
  }, []);

  const cancelScheduledPositionRefresh = useCallback(() => {
    if (positionFrameRef.current != null) {
      window.cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = null;
    }
    if (followupPositionFrameRef.current != null) {
      window.cancelAnimationFrame(followupPositionFrameRef.current);
      followupPositionFrameRef.current = null;
    }
  }, []);

  const schedulePositionRefresh = useCallback((revealWhenSettled = false) => {
    cancelScheduledPositionRefresh();
    // Re-anchor after the next paint(s) so late focus/scroll/layout shifts do not
    // leave the portal menu stuck on a stale first measurement.
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      updateMenuPosition();
      followupPositionFrameRef.current = window.requestAnimationFrame(() => {
        followupPositionFrameRef.current = null;
        updateMenuPosition();
        if (revealWhenSettled) {
          setMenuReady(true);
        }
      });
    });
  }, [cancelScheduledPositionRefresh, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!open) {
      cancelScheduledPositionRefresh();
      setMenuReady(false);
      return;
    }
    updateMenuPosition();
    if (!menuReady) {
      schedulePositionRefresh(true);
      return;
    }
    schedulePositionRefresh();
  }, [
    cancelScheduledPositionRefresh,
    options.length,
    menuReady,
    open,
    schedulePositionRefresh,
    updateMenuPosition,
  ]);

  useOverlayAutoUpdate({
    enabled: open,
    onUpdate: updateMenuPosition,
    observeRefs: [triggerRef, menuRef],
    watchScroll: true,
  });

  useEffect(() => cancelScheduledPositionRefresh, [cancelScheduledPositionRefresh]);

  useLayoutEffect(() => {
    if (!menuReady || !activeDescendantId || (highlightedOption && !highlight?.keyboard)) return;
    document.getElementById(activeDescendantId)?.scrollIntoView({ block: "nearest" });
  }, [activeDescendantId, highlight?.keyboard, highlightedOption, menuReady]);

  useEffect(() => {
    if (!disabled || !open) return;
    closeMenu();
  }, [closeMenu, disabled, open]);

  const commitValue = (next: string | null) => {
    onChange(next);
    closeMenu();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (disabled || event.defaultPrevented || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Tab":
        if (open) closeMenu();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (event.repeat) return;
        if (!open) openMenu();
        else if (activeOption) commitValue(activeOption.value);
        return;
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        event.preventDefault();
        const direction = event.key === "ArrowDown" || event.key === "Home" ? 1 : -1;
        const edge = event.key === "Home" || event.key === "End";
        if (!open) {
          openMenu();
          if (!edge) return;
        }
        const start = edge ? (direction === 1 ? -1 : 0) : activeOption?.index ?? -1;
        const option = options[getNextEnabledIndex(options, start, direction)];
        if (option) setHighlight({ option, keyboard: true });
      }
    }
  };

  const renderOption = (option: MenuOption) => (
    <PressButton
      key={option.index}
      id={`${listId}-option-${option.index}`}
      type="button"
      className={`ui-select-option${option.value === value ? " is-selected" : ""}${option === activeOption ? " is-active" : ""}`}
      role="option"
      aria-selected={option.value === value}
      tabIndex={-1}
      pressOnPointerDown={false}
      onMouseDown={(event) => event.preventDefault()}
      disabled={option.disabled}
      onPointerMove={() => {
        if (!option.disabled && activeOption !== option) setHighlight({ option, keyboard: false });
      }}
      onClick={() => commitValue(option.value)}
    >
      {option.label}
    </PressButton>
  );

  return (
    <div
      ref={rootRef}
      className={`ui-select${open ? " is-open" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <PressButton
        ref={triggerRef}
        type="button"
        pressOnPointerDown={false}
        className="ui-select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeDescendantId}
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (disabled) return;
          if (open) {
            closeMenu();
            return;
          }
          openMenu();
        }}
        disabled={disabled}
      >
        <span className={`ui-select-value${selectedOption?.value != null ? "" : " is-placeholder"}`}>
          {selectedOption?.label ?? placeholder ?? "Select"}
        </span>
        <ChevronDownIcon className="ui-select-caret" />
      </PressButton>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              className={`ui-select-menu${menuClassName ? ` ${menuClassName}` : ""}`}
              role="listbox"
              onKeyDown={handleKeyDown}
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                width: `${menuPosition.width}px`,
                maxHeight: `${menuPosition.maxHeight}px`,
                visibility: menuReady ? "visible" : "hidden",
                pointerEvents: menuReady ? "auto" : "none",
              }}
            >
              {clearOption && renderOption(clearOption)}
              {menuGroups.map((group) => (
                <div key={group.id} className="ui-select-group">
                  {group.label ? <div className="ui-select-group-label">{group.label}</div> : null}
                  {group.options.map(renderOption)}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
