// Context menu overlay with viewport-aware positioning.
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContextMenuItem } from "@/types";
import { CONTEXT_MENU_EDGE, CONTEXT_MENU_GAP, CONTEXT_SUBMENU_GAP } from "@/constants";
import { PressButton } from "./PressButton";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MENU_EDGE = CONTEXT_MENU_EDGE;
const MENU_GAP = CONTEXT_MENU_GAP;
const SUBMENU_GAP = CONTEXT_SUBMENU_GAP;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const alignAxis = (anchor: number, size: number, viewport: number) => {
  const available = viewport - MENU_EDGE * 2;
  if (available <= 0 || size >= available) {
    return MENU_EDGE;
  }
  const maxStart = viewport - MENU_EDGE - size;
  const minStart = MENU_EDGE;

  if (anchor + size + MENU_GAP <= viewport - MENU_EDGE) {
    return anchor + MENU_GAP;
  }
  if (anchor - size - MENU_GAP >= MENU_EDGE) {
    return anchor - size - MENU_GAP;
  }

  return clamp(anchor - size / 2, minStart, maxStart);
};

const getViewportSize = () => {
  const root = document.documentElement;
  return {
    width: root.clientWidth,
    height: root.clientHeight,
  };
};

export const ContextMenu = ({ open, x, y, items, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [submenuOffset, setSubmenuOffset] = useState(0);
  const lastOpenItemsRef = useRef<ContextMenuItem[]>(items);
  const menuStyle = useMemo<CSSProperties>(
    () => ({
      left: position.x,
      top: position.y,
    }),
    [position.x, position.y],
  );
  // Freeze the last visible items so close animations don't flash new content.
  useLayoutEffect(() => {
    if (!open) return;
    lastOpenItemsRef.current = items;
  }, [items, open]);
  const renderedItems = open ? items : lastOpenItemsRef.current;

  useEffect(() => {
    if (!open) {
      setOpenSubmenuId(null);
    }
  }, [open]);

  useEffect(() => {
    setOpenSubmenuId(null);
    setSubmenuOffset(0);
  }, [items]);

  useEffect(() => {
    if (!openSubmenuId) {
      setSubmenuOffset(0);
    }
  }, [openSubmenuId]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = getViewportSize();
    // Align toward the cursor, flipping when space runs out.
    const nextX = alignAxis(x, rect.width, viewport.width);
    const nextY = alignAxis(y, rect.height, viewport.height);
    setPosition({ x: nextX, y: nextY });
  }, [items.length, open, x, y]);

  useLayoutEffect(() => {
    if (!open || !openSubmenuId) return;
    const menu = menuRef.current;
    const submenu = submenuRef.current;
    if (!menu || !submenu) return;
    const anchor = menu.querySelector(
      `[data-submenu-id="${openSubmenuId}"]`,
    ) as HTMLElement | null;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const viewport = getViewportSize();
    const fitsRight =
      anchorRect.right + SUBMENU_GAP + submenuRect.width <= viewport.width - MENU_EDGE;
    const fitsLeft =
      anchorRect.left - SUBMENU_GAP - submenuRect.width >= MENU_EDGE;
    setSubmenuSide(fitsRight || !fitsLeft ? "right" : "left");
    const minTop = MENU_EDGE;
    const maxTop = viewport.height - MENU_EDGE - submenuRect.height;
    const safeMax = maxTop < minTop ? minTop : maxTop;
    const clampedTop = clamp(anchorRect.top, minTop, safeMax);
    setSubmenuOffset(clampedTop - anchorRect.top);
  }, [items.length, open, openSubmenuId]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleScroll = () => onClose();

    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [onClose, open]);

  const renderMenuItems = (menuItems: ContextMenuItem[], depth = 0) =>
    menuItems.map((item) => {
      if (item.kind === "divider") {
        return <div key={item.id} className="context-divider" role="separator" />;
      }
      if (item.kind === "submenu") {
        const isOpen = openSubmenuId === item.id;
        const isDisabled = Boolean(item.disabled);
        return (
          <div
            key={item.id}
            className={`context-item-group${isOpen ? " is-open" : ""}${
              isDisabled ? " is-disabled" : ""
            }`}
            data-submenu-id={item.id}
            onPointerEnter={() => {
              if (isDisabled) return;
              setOpenSubmenuId(item.id);
            }}
          >
            <PressButton
              type="button"
              className="context-item context-item--submenu"
              onClick={(event) => {
                event.preventDefault();
                if (isDisabled) return;
                setOpenSubmenuId((current) => (current === item.id ? null : item.id));
              }}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              disabled={item.disabled}
            >
              <span className="context-check" />
              <span className="context-label">{item.label}</span>
              <span className="context-right">
                {item.hint ? <span className="context-hint">{item.hint}</span> : null}
                <span className="context-caret" aria-hidden="true">
                  &gt;
                </span>
              </span>
            </PressButton>
            {isOpen ? (
              <div
                ref={submenuRef}
                className={`context-submenu${submenuSide === "left" ? " is-left" : " is-right"}`}
                role="menu"
                style={{ top: submenuOffset }}
              >
                <div className="context-submenu-list">
                  {renderMenuItems(item.items, depth + 1)}
                </div>
              </div>
            ) : null}
          </div>
        );
      }
      const isRadio = typeof item.active === "boolean";
      return (
        <PressButton
          key={item.id}
          type="button"
          className={`context-item${item.active ? " is-active" : ""}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          onPointerEnter={
            depth === 0
              ? () => {
                  if (openSubmenuId) {
                    setOpenSubmenuId(null);
                  }
                }
              : undefined
          }
          role={isRadio ? "menuitemradio" : "menuitem"}
          aria-checked={isRadio ? (item.active ? true : false) : undefined}
          disabled={item.disabled}
        >
          <span className="context-check">{item.active ? "x" : ""}</span>
          <span className="context-label">{item.label}</span>
          {item.hint ? <span className="context-hint">{item.hint}</span> : null}
        </PressButton>
      );
    });

  return (
    <div
      ref={menuRef}
      className="context-menu"
      data-open={open ? "true" : "false"}
      style={menuStyle}
      role="menu"
      aria-hidden={!open}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-list">{renderMenuItems(renderedItems)}</div>
    </div>
  );
};
