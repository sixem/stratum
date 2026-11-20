// Context menu overlay with viewport-aware positioning.
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CopyActionIcon,
  ContextChevronRightIcon,
  ConvertIcon,
  DeleteActionIcon,
  OpenExternalIcon,
  QuickConvertIcon,
} from "@/components/icons";
import {
  ContextCutIcon,
  ContextGalleryIcon,
  ContextMoreOptionsIcon,
  ContextOpenIcon,
  ContextPropertiesIcon,
  ContextRenameIcon,
} from "@/components/icons/contextMenuIcons";
import type { ContextMenuIcon, ContextMenuItem } from "@/types";
import { CONTEXT_MENU_EDGE, CONTEXT_MENU_GAP, CONTEXT_SUBMENU_GAP } from "@/constants";
import { PressButton } from "@/components/primitives/PressButton";
import { alignFloatingAxis, clamp, getViewportSize } from "./overlayUtils";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { focusFirstMenuItem, handleContextMenuKey } from "./contextMenuKeyboard";

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

const contextIcons = {
  open: ContextOpenIcon,
  "open-external": OpenExternalIcon,
  "open-gallery": ContextGalleryIcon,
  convert: ConvertIcon,
  "quick-convert": QuickConvertIcon,
  cut: ContextCutIcon,
  copy: CopyActionIcon,
  delete: DeleteActionIcon,
  rename: ContextRenameIcon,
  properties: ContextPropertiesIcon,
  "more-options": ContextMoreOptionsIcon,
} satisfies Record<ContextMenuIcon, typeof CopyActionIcon>;

const renderContextIcon = (icon: ContextMenuIcon) => {
  const Icon = contextIcons[icon];
  return <Icon className="context-check-icon" />;
};

export const ContextMenu = ({ open, x, y, items, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [submenuOffset, setSubmenuOffset] = useState(0);
  const lastOpenItemsRef = useRef<ContextMenuItem[]>(items);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const previous = document.activeElement;
    focusFirstMenuItem(menu);
    return () => {
      const active = document.activeElement;
      if (previous instanceof HTMLElement && previous.isConnected &&
          (menu.contains(active) || active === document.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useOverlayDismiss({
    enabled: open,
    refs: [menuRef],
    onEscape: onClose,
    onPointerDownOutside: onClose,
    onScroll: onClose,
    onResize: onClose,
  });

  const closeSubmenu = useCallback(() => {
    setOpenSubmenuId(null);
    setSubmenuOffset(0);
  }, []);

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
    if (open) return;
    closeSubmenu();
  }, [closeSubmenu, open]);

  useEffect(() => {
    if (!openSubmenuId) return;
    // Clipboard refreshes and Open With lookups can replace the items while the menu is in use.
    const available = items.some((item) =>
      item.kind === "submenu" && item.id === openSubmenuId && !item.disabled);
    if (!available) closeSubmenu();
  }, [closeSubmenu, items, openSubmenuId]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = getViewportSize();
    // Align toward the cursor, flipping when space runs out.
    const nextX = alignFloatingAxis(x, rect.width, viewport.width, MENU_EDGE, MENU_GAP);
    const nextY = alignFloatingAxis(y, rect.height, viewport.height, MENU_EDGE, MENU_GAP);
    setPosition({ x: nextX, y: nextY });
  }, [items, open, x, y]);

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
              pressOnPointerDown={false}
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                if (isDisabled) return;
                setOpenSubmenuId((current) => {
                  if (current === item.id) {
                    setSubmenuOffset(0);
                    return null;
                  }
                  return item.id;
                });
              }}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              disabled={item.disabled}
            >
              <span className="context-check">{item.icon ? renderContextIcon(item.icon) : null}</span>
              <span className="context-label">{item.label}</span>
              <span className="context-right">
                {item.hint ? <span className="context-hint">{item.hint}</span> : null}
                <span className="context-caret" aria-hidden="true">
                  <ContextChevronRightIcon />
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
          pressOnPointerDown={false}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          onPointerEnter={
            depth === 0
              ? () => {
                  if (!openSubmenuId) return;
                  closeSubmenu();
                }
              : undefined
          }
          role={isRadio ? "menuitemradio" : "menuitem"}
          aria-checked={isRadio ? (item.active ? true : false) : undefined}
          disabled={item.disabled}
        >
          <span className="context-check">
            {item.icon ? renderContextIcon(item.icon) : item.active ? "x" : ""}
          </span>
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
      inert={!open}
      onKeyDown={handleContextMenuKey}
      onBlur={(event) => {
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-list">{renderMenuItems(renderedItems)}</div>
    </div>
  );
};
