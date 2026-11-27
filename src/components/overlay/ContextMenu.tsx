// Context menu overlay with viewport-aware positioning.
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CopyActionIcon,
  ContextChevronRightIcon,
  ConvertIcon,
  DeleteActionIcon,
  EyeOffIcon,
  OpenExternalIcon,
  PlusIcon,
  QuickConvertIcon,
  RefreshIcon,
  TabCloseIcon,
} from "@/components/icons";
import {
  AnchorIcon,
  ContextCutIcon,
  ContextGalleryIcon,
  ContextInvertSelectionIcon,
  ContextMoreOptionsIcon,
  ContextNewFileIcon,
  ContextNewFolderIcon,
  ContextOpenFolderIcon,
  ContextOpenIcon,
  ContextOpenNewTabIcon,
  ContextOpenWithIcon,
  ContextPasteIcon,
  ContextPasteIntoFolderIcon,
  ContextPinIcon,
  ContextPropertiesIcon,
  ContextRenameIcon,
  ContextSelectSameExtensionIcon,
  ContextTerminalIcon,
  ContextUnpinIcon,
  ContextUnlinkIcon,
  Link2Icon,
} from "@/components/icons/contextMenuIcons";
import type { ContextMenuIcon, ContextMenuItem } from "@/types";
import { CONTEXT_MENU_EDGE, CONTEXT_MENU_GAP, CONTEXT_SUBMENU_GAP } from "@/constants";
import { PressButton } from "@/components/primitives/PressButton";
import { alignFloatingAxis, clamp, getViewportSize } from "./overlayUtils";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { focusFirstMenuItem, handleContextMenuKey } from "./contextMenuKeyboard";
import { TooltipWrapper } from "./Tooltip";
import { PinShapeIcon } from "@/components/icons/PinShapeIcon";
import { useSettingsStore } from "@/modules";
import type { PinShape } from "@/modules";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  onOpenNative?: () => boolean;
  scrollContainer?: RefObject<HTMLElement | null>;
  scrollable?: boolean;
  focusFirstItem?: boolean;
};

const MENU_EDGE = CONTEXT_MENU_EDGE;
const MENU_GAP = CONTEXT_MENU_GAP;
const SUBMENU_GAP = CONTEXT_SUBMENU_GAP;

const contextIcons = {
  open: ContextOpenIcon,
  "open-external": OpenExternalIcon,
  "open-folder": ContextOpenFolderIcon,
  "open-gallery": ContextGalleryIcon,
  "open-new-tab": ContextOpenNewTabIcon,
  "open-with": ContextOpenWithIcon,
  "new-folder": ContextNewFolderIcon,
  "new-file": ContextNewFileIcon,
  paste: ContextPasteIcon,
  "paste-into-folder": ContextPasteIntoFolderIcon,
  terminal: ContextTerminalIcon,
  anchor: AnchorIcon,
  "split-tab": Link2Icon,
  "separate-tabs": ContextUnlinkIcon,
  pin: ContextPinIcon,
  unpin: ContextUnpinIcon,
  add: PlusIcon,
  remove: TabCloseIcon,
  hide: EyeOffIcon,
  refresh: RefreshIcon,
  convert: ConvertIcon,
  "quick-convert": QuickConvertIcon,
  cut: ContextCutIcon,
  copy: CopyActionIcon,
  delete: DeleteActionIcon,
  rename: ContextRenameIcon,
  "select-same-extension": ContextSelectSameExtensionIcon,
  "invert-selection": ContextInvertSelectionIcon,
  properties: ContextPropertiesIcon,
  "more-options": ContextMoreOptionsIcon,
} satisfies Record<Exclude<ContextMenuIcon, "pin-shape">, typeof CopyActionIcon>;

const renderContextIcon = (icon: ContextMenuIcon, pinShape: PinShape) => {
  if (icon === "pin-shape") return <PinShapeIcon shape={pinShape} className="context-check-icon" />;
  const Icon = contextIcons[icon];
  return <Icon className="context-check-icon" />;
};

// Icon colors are independent of the selected label's accent color.
const iconColorStyle = (color?: string): CSSProperties | undefined =>
  color ? { "--context-icon-color": color } as CSSProperties : undefined;

export const ContextMenu = ({
  open, x, y, items, onClose, onOpenNative, scrollContainer, scrollable = false, focusFirstItem = false,
}: ContextMenuProps) => {
  const pinShape = useSettingsStore((state) => state.pinShape);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });
  const lastOpenMenuRef = useRef({ items, scrollable });
  const scrollPositionRef = useRef<{ element: HTMLElement; top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const element = scrollContainer?.current;
    scrollPositionRef.current = element ? { element, top: element.scrollTop, left: element.scrollLeft } : null;
    const previous = document.activeElement;
    if (scrollable && listRef.current) listRef.current.scrollTop = 0;
    // Pointer-opened menus receive keyboard input without highlighting an item.
    if (focusFirstItem) focusFirstMenuItem(menu);
    else menu.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (previous instanceof HTMLElement && previous.isConnected &&
          (menu.contains(active) || active === document.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [focusFirstItem, open, scrollContainer, scrollable]);

  const handleScroll = useCallback((event: Event) => {
    if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
    const position = scrollPositionRef.current;
    // A scroll event can arrive after opening even if the anchor has already settled.
    if (position && position.element.scrollTop === position.top && position.element.scrollLeft === position.left) return;
    onClose();
  }, [onClose]);

  useOverlayDismiss({
    enabled: open,
    refs: [menuRef],
    onEscape: onClose,
    onPointerDownOutside: onClose,
    pointerDownCapture: true,
    onScroll: handleScroll,
    onResize: onClose,
  });

  const closeSubmenu = useCallback(() => {
    setOpenSubmenuId(null);
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
    lastOpenMenuRef.current = { items, scrollable };
  }, [items, open, scrollable]);
  const renderedMenu = open ? { items, scrollable } : lastOpenMenuRef.current;

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
  }, [items, open, scrollable, x, y]);

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
    setSubmenuPosition({
      x: fitsRight || !fitsLeft ? anchorRect.right + SUBMENU_GAP : anchorRect.left - SUBMENU_GAP - submenuRect.width,
      y: clampedTop,
    });
  }, [items, open, openSubmenuId]);

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
              <span className="context-check" style={iconColorStyle(item.iconColor)} aria-hidden="true">
                {item.icon ? renderContextIcon(item.icon, pinShape) : null}
              </span>
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
                data-wide={item.wide || undefined}
                role="menu"
                style={{ left: submenuPosition.x, top: submenuPosition.y }}
              >
                <div className="context-submenu-list">
                  {renderMenuItems(item.items, depth + 1)}
                </div>
              </div>
            ) : null}
          </div>
        );
      }
      const isCheckbox = typeof item.checked === "boolean";
      const checked = item.checked ?? item.active;
      const label = <span className="context-label">{item.label}</span>;
      const button = (
        <PressButton
          key={item.id}
          type="button"
          className={`context-item${checked ? " is-active" : ""}`}
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
          role={isCheckbox ? "menuitemcheckbox" : typeof item.active === "boolean" ? "menuitemradio" : "menuitem"}
          aria-checked={checked}
          disabled={item.disabled}
        >
          <span className="context-check" style={iconColorStyle(item.iconColor)} aria-hidden="true">
            {item.iconUrl ? (
              <img
                key={item.iconUrl}
                className="context-check-icon"
                src={item.iconUrl}
                alt=""
                draggable={false}
                decoding="async"
                onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
              />
            ) : item.icon ? renderContextIcon(item.icon, pinShape) : checked ? "x" : ""}
          </span>
          {item.disabled && item.tooltip ? (
            <TooltipWrapper text={item.tooltip} withinContextMenu>{label}</TooltipWrapper>
          ) : label}
          {item.hint ? <span className="context-hint">{item.hint}</span> : null}
        </PressButton>
      );
      return item.tooltip && !item.disabled ? (
        <TooltipWrapper key={item.id} text={item.tooltip} withinContextMenu>
          {button}
        </TooltipWrapper>
      ) : button;
    });

  return (
    <div
      ref={menuRef}
      className="context-menu"
      data-open={open ? "true" : "false"}
      data-scrollable={renderedMenu.scrollable || undefined}
      style={menuStyle}
      role="menu"
      tabIndex={-1}
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.shiftKey && event.key === "F10" && onOpenNative?.()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        handleContextMenuKey(event);
      }}
      onPointerDown={(event) => { if (event.button === 2) event.stopPropagation(); }}
      onPointerUp={(event) => { if (event.button === 2) event.stopPropagation(); }}
      onBlur={(event) => {
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-list" ref={listRef} onScroll={closeSubmenu}>{renderMenuItems(renderedMenu.items)}</div>
    </div>
  );
};
