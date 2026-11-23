// Bind the folder picker to the selection and workspace that opened it.
import { useEffect } from "react";
import { QuickMovePicker } from "@/components/overlay/quickMove/QuickMovePicker";
import { useRecentMoveDestinations } from "@/modules/recentMoveStore";
import { closeQuickMove, confirmQuickMove, useQuickMoveSession } from "@/modules/quickMoveSession";
import { usePromptStore, useSettingsStore } from "@/modules";

export const QuickMoveOverlay = () => {
  const request = useQuickMoveSession((state) => state.request);
  const indexedSearchEnabled = useSettingsStore((state) => state.indexedSearchEnabled);
  const promptOpen = usePromptStore((state) => state.prompt !== null);
  const { workspaceId, destinations } = useRecentMoveDestinations();
  const valid = indexedSearchEnabled && !promptOpen && request?.workspaceId === workspaceId;

  useEffect(() => {
    if (request && !valid) closeQuickMove(request);
  }, [request, valid]);

  if (!request || !valid) return null;

  return <QuickMovePicker
    itemCount={request.paths.length}
    workspaceId={request.workspaceId}
    recentPaths={destinations}
    isDestinationDisabled={request.isDestinationDisabled}
    onClose={() => closeQuickMove(request)}
    onSelectPath={(path) => confirmQuickMove(request, path)}
  />;
};
