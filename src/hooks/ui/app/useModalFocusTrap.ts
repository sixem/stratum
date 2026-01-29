// Manages modal focus trapping and background hiding for accessible overlays.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type UseModalFocusTrapOptions = {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

type BackgroundState = {
  ariaHidden: string | null;
  hadInertAttr: boolean;
  inertProp: boolean | null;
};

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([type=\"hidden\"]):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

const modalStack: HTMLElement[] = [];
let backgroundState: Map<HTMLElement, BackgroundState> | null = null;
let appShell: HTMLElement | null = null;

const getBackgroundState = (element: HTMLElement): BackgroundState => {
  const inertProp = "inert" in element ? Boolean((element as HTMLElement & { inert?: boolean }).inert) : null;
  return {
    ariaHidden: element.getAttribute("aria-hidden"),
    hadInertAttr: element.hasAttribute("inert"),
    inertProp,
  };
};

const setInert = (element: HTMLElement, inert: boolean) => {
  const inertable = element as HTMLElement & { inert?: boolean };
  if ("inert" in inertable) {
    inertable.inert = inert;
  }
  if (inert) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
};

const restoreBackgroundState = (element: HTMLElement, state: BackgroundState) => {
  if (state.ariaHidden == null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", state.ariaHidden);
  }
  if (state.inertProp != null) {
    (element as HTMLElement & { inert?: boolean }).inert = state.inertProp;
  }
  if (state.hadInertAttr) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
};

const findAppShell = (node: HTMLElement) => {
  let current: HTMLElement | null = node;
  while (current) {
    if (current.classList.contains("app-shell")) {
      return current;
    }
    current = current.parentElement;
  }
  return document.querySelector<HTMLElement>(".app-shell");
};

const findOverlayRoot = (node: HTMLElement) => {
  let current: HTMLElement | null = node;
  while (current && current.parentElement) {
    if (current.parentElement.classList.contains("app-shell")) {
      return current;
    }
    current = current.parentElement;
  }
  return node;
};

const captureBackground = (overlayRoot: HTMLElement) => {
  if (!appShell) {
    appShell = findAppShell(overlayRoot);
  }
  if (!appShell || backgroundState) return;

  backgroundState = new Map();
  Array.from(appShell.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    backgroundState?.set(child, getBackgroundState(child));
  });
};

const applyBackground = (activeOverlay: HTMLElement | null) => {
  if (!backgroundState || !appShell) return;
  backgroundState.forEach((state, element) => {
    if (activeOverlay && element === activeOverlay) {
      restoreBackgroundState(element, state);
      return;
    }
    element.setAttribute("aria-hidden", "true");
    setInert(element, true);
  });
};

const releaseBackground = () => {
  if (!backgroundState) return;
  backgroundState.forEach((state, element) => {
    restoreBackgroundState(element, state);
  });
  backgroundState = null;
  appShell = null;
};

const getFocusable = (container: HTMLElement) => {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
  return candidates.filter((node) => {
    if (node.tabIndex < 0) return false;
    if (node.hasAttribute("disabled")) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  });
};

export const useModalFocusTrap = ({
  open,
  containerRef,
  initialFocusRef,
}: UseModalFocusTrapOptions) => {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const container = containerRef.current;

  useEffect(() => {
    if (!open || !container) return;

    const overlayRoot = findOverlayRoot(container);
    modalStack.push(overlayRoot);
    captureBackground(overlayRoot);
    applyBackground(overlayRoot);
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusInitial = () => {
      if (modalStack[modalStack.length - 1] !== overlayRoot) return;
      const preferred = initialFocusRef?.current;
      if (preferred && container.contains(preferred)) {
        preferred.focus({ preventScroll: true });
        return;
      }
      const focusable = getFocusable(container);
      if (focusable.length > 0) {
        focusable[0]?.focus({ preventScroll: true });
        return;
      }
      container.focus({ preventScroll: true });
    };

    const focusFirst = () => {
      const focusable = getFocusable(container);
      if (focusable.length > 0) {
        focusable[0]?.focus({ preventScroll: true });
        return;
      }
      container.focus({ preventScroll: true });
    };

    const focusLast = () => {
      const focusable = getFocusable(container);
      if (focusable.length > 0) {
        focusable[focusable.length - 1]?.focus({ preventScroll: true });
        return;
      }
      container.focus({ preventScroll: true });
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (modalStack[modalStack.length - 1] !== overlayRoot) return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!active || active === focusable[0]) {
          event.preventDefault();
          focusLast();
        }
      } else if (active === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusFirst();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (modalStack[modalStack.length - 1] !== overlayRoot) return;
      const target = event.target as Node | null;
      if (target && container.contains(target)) return;
      focusFirst();
    };

    const focusTimer = window.setTimeout(() => {
      focusInitial();
    }, 0);

    window.addEventListener("keydown", handleKeydown, { capture: true });
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeydown, { capture: true });
      document.removeEventListener("focusin", handleFocusIn);

      const index = modalStack.lastIndexOf(overlayRoot);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      if (modalStack.length === 0) {
        releaseBackground();
      } else {
        applyBackground(modalStack[modalStack.length - 1] ?? null);
      }

      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, [container, initialFocusRef, open]);
};
