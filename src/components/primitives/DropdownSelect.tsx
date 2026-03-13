// Reusable themed dropdown built on a button + listbox.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@/components/icons";
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

type FlattenedOption = DropdownOption & {
  groupId: string;
};

const isSameValue = (left: string | null, right: string | null) => left === right;
const MENU_EDGE = 8;
const MENU_GAP = 6;
const POSITION_EPSILON_PX = 0.5;

const getNextEnabledIndex = (
  options: FlattenedOption[],
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
  placeholder = "Select",
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
  const [activeIndex, setActiveIndex] = useState(-1);
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

  const flattenedOptions = useMemo<FlattenedOption[]>(
    () =>
      groups.flatMap((group) =>
        group.options.map((option) => ({
          ...option,
          groupId: group.id,
        })),
      ),
    [groups],
  );

  const optionIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    flattenedOptions.forEach((option, index) => {
      map.set(`${option.groupId}\u0000${option.value}`, index);
    });
    return map;
  }, [flattenedOptions]);

  const selectedOption = useMemo(
    () => flattenedOptions.find((option) => option.value === value) ?? null,
    [flattenedOptions, value],
  );

  const clearOptionId = `${listId}-clear`;
  const activeDescendantId =
    open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : open ? clearOptionId : undefined;

  const openMenu = useCallback(() => {
    setMenuReady(false);
    setOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuReady(false);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const menu = menuRef.current;
      const target = event.target as Node;
      if (!root) return;
      if (root.contains(target)) return;
      if (menu?.contains(target)) return;
      closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleEscape, { capture: true });
    };
  }, [closeMenu, open]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const measuredHeight = menuRef.current?.offsetHeight ?? 260;
    const spaceBelow = viewportHeight - rect.bottom - MENU_EDGE;
    const spaceAbove = rect.top - MENU_EDGE;
    const dropUp = measuredHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, (dropUp ? spaceAbove : spaceBelow) - MENU_GAP);
    const usedHeight = Math.min(measuredHeight, maxHeight);
    const unclampedLeft = rect.left;
    const maxLeft = Math.max(MENU_EDGE, viewportWidth - MENU_EDGE - rect.width);
    const left = Math.min(Math.max(MENU_EDGE, unclampedLeft), maxLeft);
    const top = dropUp
      ? Math.max(MENU_EDGE, rect.top - MENU_GAP - usedHeight)
      : Math.min(
          viewportHeight - MENU_EDGE - usedHeight,
          rect.bottom + MENU_GAP,
        );
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
    flattenedOptions.length,
    menuReady,
    open,
    schedulePositionRefresh,
    updateMenuPosition,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleViewport = () => {
      updateMenuPosition();
    };
    window.addEventListener("resize", handleViewport);
    window.addEventListener("scroll", handleViewport, true);
    return () => {
      window.removeEventListener("resize", handleViewport);
      window.removeEventListener("scroll", handleViewport, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateMenuPosition();
    });
    if (triggerRef.current) {
      observer.observe(triggerRef.current);
    }
    if (menuRef.current) {
      observer.observe(menuRef.current);
    }
    return () => observer.disconnect();
  }, [open, updateMenuPosition]);

  useEffect(() => cancelScheduledPositionRefresh, [cancelScheduledPositionRefresh]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = flattenedOptions.findIndex((option) => option.value === value);
    if (selectedIndex >= 0 && !flattenedOptions[selectedIndex]?.disabled) {
      setActiveIndex(selectedIndex);
      return;
    }
    setActiveIndex(getNextEnabledIndex(flattenedOptions, -1, 1));
  }, [flattenedOptions, open, value]);

  useEffect(() => {
    if (!disabled || !open) return;
    closeMenu();
  }, [closeMenu, disabled, open]);

  const commitValue = (next: string | null) => {
    onChange(next);
    closeMenu();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => getNextEnabledIndex(flattenedOptions, current, direction));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      if (!open) {
        openMenu();
      }
      setActiveIndex(getNextEnabledIndex(flattenedOptions, -1, 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      if (!open) {
        openMenu();
      }
      setActiveIndex(getNextEnabledIndex(flattenedOptions, 0, -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && event.key === "Enter") {
        if (activeIndex < 0) {
          commitValue(null);
          return;
        }
        const active = flattenedOptions[activeIndex];
        if (active && !active.disabled) {
          commitValue(active.value);
          return;
        }
      }
      if (open) {
        closeMenu();
        return;
      }
      openMenu();
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => getNextEnabledIndex(flattenedOptions, current, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => getNextEnabledIndex(flattenedOptions, current, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex < 0) return;
      const active = flattenedOptions[activeIndex];
      if (!active || active.disabled) return;
      commitValue(active.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(getNextEnabledIndex(flattenedOptions, -1, 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(getNextEnabledIndex(flattenedOptions, 0, -1));
    }
  };

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
        onKeyDown={handleTriggerKeyDown}
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
        <span className={`ui-select-value${selectedOption ? "" : " is-placeholder"}`}>
          {selectedOption?.label ?? placeholder}
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
              onKeyDown={handleMenuKeyDown}
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                width: `${menuPosition.width}px`,
                maxHeight: `${menuPosition.maxHeight}px`,
                visibility: menuReady ? "visible" : "hidden",
                pointerEvents: menuReady ? "auto" : "none",
              }}
            >
              <PressButton
                type="button"
                className={`ui-select-option${
                  isSameValue(value, null) ? " is-selected" : ""
                }${activeIndex === -1 ? " is-active" : ""}`}
                id={clearOptionId}
                role="option"
                aria-selected={isSameValue(value, null)}
                onPointerEnter={() => setActiveIndex(-1)}
                onClick={() => commitValue(null)}
              >
                {placeholder}
              </PressButton>
              {groups.map((group) => (
                <div key={group.id} className="ui-select-group">
                  {group.label ? <div className="ui-select-group-label">{group.label}</div> : null}
                  {group.options.map((option) => {
                    const index = optionIndexByKey.get(`${group.id}\u0000${option.value}`) ?? -1;
                    const isSelected = option.value === value;
                    const isActive = index === activeIndex;
                    return (
                      <PressButton
                        key={`${group.id}-${option.value}`}
                        id={index >= 0 ? `${listId}-option-${index}` : undefined}
                        type="button"
                        className={`ui-select-option${isSelected ? " is-selected" : ""}${
                          isActive ? " is-active" : ""
                        }`}
                        role="option"
                        aria-selected={isSelected}
                        disabled={option.disabled}
                        onPointerEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          if (option.disabled) return;
                          commitValue(option.value);
                        }}
                      >
                        {option.label}
                      </PressButton>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
