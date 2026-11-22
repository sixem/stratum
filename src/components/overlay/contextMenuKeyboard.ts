import type { KeyboardEvent } from "react";

// Limit arrow traversal to the current menu level, skipping disabled items and dividers.
const enabledItems = (menu: Element) =>
  Array.from(menu.querySelectorAll<HTMLButtonElement>("button.context-item:enabled"))
    .filter((item) => item.closest('[role="menu"]') === menu);

export const focusFirstMenuItem = (menu: Element) => {
  enabledItems(menu)[0]?.focus({ preventScroll: true });
};

export const handleContextMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button.context-item");
  const menu = button?.closest('[role="menu"]') ?? event.currentTarget;
  const items = enabledItems(menu);
  const index = button ? items.indexOf(button) : -1;
  const focus = (at: number) => items[at]?.focus({ preventScroll: menu === event.currentTarget });
  switch (event.key) {
    case "ArrowDown": focus((index + 1) % items.length); break;
    case "ArrowUp": focus(index <= 0 ? items.length - 1 : index - 1); break;
    case "Home": focus(0); break;
    case "End": focus(items.length - 1); break;
    case "ArrowRight": {
      if (button?.getAttribute("aria-haspopup") !== "menu") return;
      if (button.getAttribute("aria-expanded") !== "true") button.click();
      requestAnimationFrame(() => {
        const submenu = button.nextElementSibling;
        if (submenu?.getAttribute("role") === "menu") focusFirstMenuItem(submenu);
      });
      break;
    }
    case "ArrowLeft":
    case "Escape": {
      if (menu === event.currentTarget) return;
      const parent = menu.previousElementSibling;
      if (!(parent instanceof HTMLButtonElement)) return;
      parent.focus({ preventScroll: true });
      parent.click();
      break;
    }
    default: return;
  }
  event.preventDefault();
  event.stopPropagation();
};
