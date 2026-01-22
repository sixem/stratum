// Manages path/search inputs and view focus behavior for the main panel.
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";

type UseAppViewStateOptions = {
  currentPath: string;
  parentPath: string | null;
  loading: boolean;
  loadDir: (path: string) => Promise<void>;
  jumpTo: (path: string) => void;
  browseTo: (path: string) => void;
};

export const useAppViewState = ({
  currentPath,
  parentPath,
  loading,
  loadDir,
  jumpTo,
  browseTo,
}: UseAppViewStateOptions) => {
  const [pathValue, setPathValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [pendingViewFocus, setPendingViewFocus] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPathValue(currentPath);
  }, [currentPath]);

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
      void loadDir(path);
    },
    [loadDir, searchValue],
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
  };
};
