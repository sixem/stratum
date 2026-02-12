// Navigation orchestration for App.tsx: tab/path handlers + downward trail navigation.
import { useCallback, useMemo } from "react";
import { getNextTrailPath } from "@/lib";
import { useAppHandlers } from "./useAppHandlers";

type AppHandlersOptions = Parameters<typeof useAppHandlers>[0];

type UseAppNavigationControllerOptions = AppHandlersOptions & {
  browseFromView: (path: string) => void;
  viewPath: string;
  crumbTrailPath: string;
};

export const useAppNavigationController = ({
  browseFromView,
  viewPath,
  crumbTrailPath,
  ...handlerOptions
}: UseAppNavigationControllerOptions) => {
  const handlers = useAppHandlers(handlerOptions);
  const nextTrailPath = useMemo(
    () => getNextTrailPath(viewPath, crumbTrailPath),
    [crumbTrailPath, viewPath],
  );
  const canGoDown = Boolean(nextTrailPath);
  const handleDown = useCallback(() => {
    if (!nextTrailPath) return;
    browseFromView(nextTrailPath);
  }, [browseFromView, nextTrailPath]);

  return {
    ...handlers,
    canGoDown,
    handleDown,
  };
};

