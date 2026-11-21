// Manages path/search inputs and view focus behavior for the main panel.
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ListDirOptions } from "@/types";

type UseAppViewStateOptions = {
  displayPath: string;
  parentPath: string | null;
  searchValue: string;
  setSearchValue: (value: string) => void;
  jumpTo: (path: string, options?: ListDirOptions) => void;
  browseTo: (path: string, options?: ListDirOptions) => void;
};

export const useAppViewState = ({
  displayPath,
  parentPath,
  searchValue,
  setSearchValue,
  jumpTo,
  browseTo,
}: UseAppViewStateOptions) => {
  const [pathValue, setPathValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    // Sync the path input before paint so tab switches feel immediate.
    setPathValue(displayPath);
  }, [displayPath]);

  const browseFromView = useCallback(
    (path: string) => {
      if (searchValue.trim()) {
        mainRef.current?.focus({ preventScroll: true });
      }
      browseTo(path);
    },
    [browseTo, searchValue],
  );

  const handleGo = useCallback(() => {
    const trimmed = pathValue.trim();
    if (!trimmed) return;
    jumpTo(trimmed);
  }, [jumpTo, pathValue]);

  const handleUp = useCallback(() => {
    if (!parentPath) return;
    browseTo(parentPath);
  }, [browseTo, parentPath]);

  // Clear the search field and move focus back to the main view.
  const clearSearchAndFocusView = useCallback(() => {
    setSearchValue("");
    mainRef.current?.focus({ preventScroll: true });
  }, [setSearchValue]);

  return {
    pathValue,
    setPathValue,
    deferredSearchValue,
    searchInputRef,
    mainRef,
    browseFromView,
    handleGo,
    handleUp,
    clearSearchAndFocusView,
  };
};
