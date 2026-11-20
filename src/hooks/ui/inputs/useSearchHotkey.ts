import { useEffect } from "react";
import type { RefObject } from "react";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "preventDefault">;

export const handleSearchHotkey = (
  event: ShortcutEvent,
  input: HTMLInputElement | null,
  onClear?: () => void,
): boolean => {
  if (event.defaultPrevented || event.altKey || event.shiftKey ||
      !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") {
    return false;
  }
  event.preventDefault();
  if (input && !input.disabled) {
    if (document.activeElement === input) {
      onClear?.();
    } else {
      input.focus({ preventScroll: true });
      input.select();
    }
  }
  return true;
};

// Ctrl/Cmd+F focuses the search input without browser find.
// When the search input is already focused, trigger the clear action instead.
export const useSearchHotkey = (
  inputRef: RefObject<HTMLInputElement | null>,
  onClear?: () => void,
) => {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      handleSearchHotkey(event, inputRef.current, onClear);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [inputRef, onClear]);
};
