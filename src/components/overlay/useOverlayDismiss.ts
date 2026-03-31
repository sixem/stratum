// Shared dismissal wiring for lightweight overlays that close on escape,
// outside pointer interaction, or viewport movement.
import type { RefObject } from "react";
import { useEffect } from "react";

type DismissRef = RefObject<Element | null>;

type UseOverlayDismissOptions = {
  enabled: boolean;
  refs?: DismissRef[];
  onEscape?: () => void;
  onPointerDown?: () => void;
  onPointerDownOutside?: () => void;
  onScroll?: () => void;
  onResize?: () => void;
  keydownCapture?: boolean;
  pointerDownCapture?: boolean;
  scrollCapture?: boolean;
};

const containsTarget = (refs: DismissRef[], target: Node | null) => {
  if (!target) return false;
  return refs.some((ref) => ref.current?.contains(target));
};

export const useOverlayDismiss = ({
  enabled,
  refs = [],
  onEscape,
  onPointerDown,
  onPointerDownOutside,
  onScroll,
  onResize,
  keydownCapture = false,
  pointerDownCapture = false,
  scrollCapture = true,
}: UseOverlayDismissOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onEscape?.();
    };

    const handlePointerDown = (event: PointerEvent) => {
      onPointerDown?.();
      if (!onPointerDownOutside) return;
      if (containsTarget(refs, event.target as Node | null)) return;
      onPointerDownOutside();
    };

    if (onEscape) {
      window.addEventListener("keydown", handleKeyDown, keydownCapture);
    }

    if (onPointerDown || onPointerDownOutside) {
      window.addEventListener("pointerdown", handlePointerDown, pointerDownCapture);
    }

    if (onScroll) {
      window.addEventListener("scroll", onScroll, scrollCapture);
    }

    if (onResize) {
      window.addEventListener("resize", onResize);
    }

    return () => {
      if (onEscape) {
        window.removeEventListener("keydown", handleKeyDown, keydownCapture);
      }
      if (onPointerDown || onPointerDownOutside) {
        window.removeEventListener("pointerdown", handlePointerDown, pointerDownCapture);
      }
      if (onScroll) {
        window.removeEventListener("scroll", onScroll, scrollCapture);
      }
      if (onResize) {
        window.removeEventListener("resize", onResize);
      }
    };
  }, [
    enabled,
    keydownCapture,
    onEscape,
    onPointerDown,
    onPointerDownOutside,
    onResize,
    onScroll,
    pointerDownCapture,
    refs,
    scrollCapture,
  ]);
};
