import { useEffect } from "react";
import type { RefObject } from "react";

// Ctrl/Cmd+F focuses the search input without browser find.
export const useSearchHotkey = (inputRef: RefObject<HTMLInputElement | null>) => {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const isFind = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      if (!isFind) return;
      event.preventDefault();
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [inputRef]);
};
