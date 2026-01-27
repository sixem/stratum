// Manages path/search inputs and view focus behavior for the main panel.
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ListDirOptions } from "@/types";

type UseAppViewStateOptions = {
  currentPath: string;
  displayPath?: string;
  parentPath: string | null;
  loading: boolean;
  jumpTo: (path: string, options?: ListDirOptions) => void;
  browseTo: (path: string, options?: ListDirOptions) => void;
};

export const useAppViewState = ({
  currentPath,
  displayPath,
  parentPath,
  loading,
  jumpTo,
  browseTo,
}: UseAppViewStateOptions) => {
  const [pathValue, setPathValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [pendingViewFocus, setPendingViewFocus] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    // Sync the path input before paint so tab switches feel immediate.
    setPathValue(displayPath ?? currentPath);
  }, [currentPath, displayPath]);

  useEffect(() => {
    // Restore focus after clearing search so keyboard navigation resumes.
    if (loading || !pendingViewFocus) return;
    if (mainRef.current) {
      mainRef.current.focus({ preventScroll: true });
    }
    setPendingViewFocus(false);
  }, [loading, pendingViewFocus]);

  const browseFromView = useCallback(
    (path: string) => {
      // Clear search before navigation so the next folder is unfiltered.
      const hadSearch = searchValue.trim().length > 0;
      if (hadSearch) {
        setSearchValue("");
        setPendingViewFocus(true);
      }
      browseTo(path, hadSearch ? { search: "" } : undefined);
    },
    [browseTo, searchValue],
  );

  const handleGo = useCallback(() => {
    const trimmed = pathValue.trim();
    if (!trimmed) return;
    jumpTo(trimmed);
  }, [jumpTo, pathValue]);

  const handleUp = useCallback(() => {
    if (loading || !parentPath) return;
    browseTo(parentPath);
  }, [browseTo, loading, parentPath]);

  // Clear the search field and move focus back to the main view.
  const clearSearchAndFocusView = useCallback(() => {
    if (searchValue.trim().length === 0) {
      if (mainRef.current) {
        mainRef.current.focus({ preventScroll: true });
      }
      return;
    }
    setSearchValue("");
    setPendingViewFocus(true);
  }, [searchValue]);

  return {
    pathValue,
    setPathValue,
    searchValue,
    setSearchValue,
    deferredSearchValue,
    searchInputRef,
    mainRef,
    browseFromView,
    handleGo,
    handleUp,
    clearSearchAndFocusView,
  };
};
