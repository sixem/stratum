// Shared accelerated-indexing launch helpers keep the settings UI and boot flow aligned.
import { getIndexingRuntimeMode, restartAsAdministrator } from "@/api";
import type { PromptConfig } from "@/modules";
import type { IndexingRuntimeMode } from "@/types";

type ShowPrompt = (prompt: PromptConfig) => void;
export type AcceleratedIndexingRelaunchResult = "launched" | "canceled" | "failed";

export const readIndexingRuntimeMode = async (): Promise<IndexingRuntimeMode> => {
  try {
    return await getIndexingRuntimeMode();
  } catch {
    return "normal";
  }
};

export const requestAcceleratedIndexingRelaunch = async ({
  showPrompt,
}: {
  showPrompt?: ShowPrompt;
}): Promise<AcceleratedIndexingRelaunchResult> => {
  try {
    await restartAsAdministrator();
    return "launched";
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to request administrator approval.";
    if (message === "Administrator approval was canceled.") {
      return "canceled";
    }
    showPrompt?.({
      title: "Unable to enable accelerated indexing",
      content: message,
      confirmLabel: "Close",
      cancelLabel: null,
    });
    return "failed";
  }
};
