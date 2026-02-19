// Preview section container for App.tsx.
// Keeps quick-preview state, refs, and derived preview metadata together.
import { useRef } from "react";
import type { EntryMeta } from "@/types";
import { useQuickPreview } from "@/hooks/ui/view/useQuickPreview";

type QuickPreviewOptions = Parameters<typeof useQuickPreview>[0];

type UseAppPreviewSectionOptions = QuickPreviewOptions & {
  entryMeta: Map<string, EntryMeta>;
};

export const useAppPreviewSection = ({
  entryMeta,
  ...quickPreviewOptions
}: UseAppPreviewSectionOptions) => {
  const previewOpenRef = useRef(false);
  const {
    previewOpen,
    previewPath,
    openPreview,
    closePreview,
    handlePreviewPress,
    handlePreviewRelease,
  } = useQuickPreview(quickPreviewOptions);

  previewOpenRef.current = previewOpen;

  const previewMeta = previewPath ? entryMeta.get(previewPath) ?? null : null;

  return {
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    openPreview,
    closePreview,
    handlePreviewPress,
    handlePreviewRelease,
  };
};
