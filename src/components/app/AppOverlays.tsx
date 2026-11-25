// Groups overlay layers to keep App render structure small and explicit.
import { Suspense, lazy, useEffect, useState } from "react";
import { AboutModal } from "@/components/overlay/AboutModal";
import { BatchRenameDialog } from "@/components/overlay/BatchRenameDialog";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { IndexedSearchModal } from "@/components/overlay/IndexedSearchModal";
import { PromptModal } from "@/components/overlay/PromptModal";
import { TooltipDisplay } from "@/components/overlay/Tooltip";
import type { ConversionModalProps } from "@/components/overlay/conversionModal";
import type { SettingsOverlayProps } from "@/components/overlay/SettingsOverlay";
import type { QuickPreviewOverlayProps } from "@/components/preview/QuickPreviewOverlay";
import { useBatchRenameStore } from "@/modules/batchRenameStore";
import { usePromptStore } from "@/modules/promptStore";
import type { ComponentProps } from "react";
import { QuickMoveOverlay } from "./QuickMoveOverlay";

const LazyConversionModal = lazy(async () => {
  const module = await import("@/components/overlay/conversionModal");
  return { default: module.ConversionModal };
});

const LazySettingsOverlay = lazy(async () => {
  const module = await import("@/components/overlay/SettingsOverlay");
  return { default: module.SettingsOverlay };
});

const useDeferredMount = (open: boolean, prewarmOnIdle = false) => {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (mounted || open || !prewarmOnIdle) return;
    if (typeof window === "undefined") return;

    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const prewarm = () => {
      setMounted(true);
    };

    // Warm hidden heavyweight overlays after the first paint so the first open feels instant.
    if (typeof idleWindow.requestIdleCallback === "function") {
      idleId = idleWindow.requestIdleCallback(() => {
        prewarm();
      }, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(prewarm, 280);
    }

    return () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (
        idleId != null &&
        typeof idleWindow.cancelIdleCallback === "function"
      ) {
        idleWindow.cancelIdleCallback(idleId);
      }
    };
  }, [mounted, open, prewarmOnIdle]);

  // An early open starts the same lazy import immediately, even before the idle callback.
  return open || mounted;
};

type GalleryModule = typeof import("@/components/preview/QuickPreviewOverlay");

function usePrewarmedGallery(open: boolean, close: () => void) {
  const load = useDeferredMount(open, true);
  const [gallery, setGallery] = useState<GalleryModule | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const shouldLoad = load && !gallery && (open || !loadFailed);

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    // Render as soon as the module arrives. Suspending on the first click can
    // keep the fallback visible for hundreds of milliseconds, even on a local disk.
    void import("@/components/preview/QuickPreviewOverlay").then(
      module => { if (active) setGallery(module); },
      () => {
        if (!active) return;
        setLoadFailed(true);
        if (!open) return;
        close();
        usePromptStore.getState().showPrompt({ title: "Gallery unavailable", content: "Could not load the gallery." });
      },
    );
    return () => { active = false; };
  }, [shouldLoad, open, close]);

  return gallery?.QuickPreviewOverlay;
}

type AppOverlaysProps = {
  about: ComponentProps<typeof AboutModal>;
  contextMenu: ComponentProps<typeof ContextMenu>;
  conversion: ConversionModalProps;
  indexedSearch: Omit<ComponentProps<typeof IndexedSearchModal>, "previewOpen">;
  quickPreview: QuickPreviewOverlayProps;
  settings: SettingsOverlayProps;
};

export const AppOverlays = ({
  about,
  contextMenu,
  conversion,
  indexedSearch,
  quickPreview,
  settings,
}: AppOverlaysProps) => {
  // Load heavyweight overlays on first use, then keep them mounted.
  const conversionMounted = useDeferredMount(conversion.open, true);
  const settingsMounted = useDeferredMount(settings.open, true);
  const Gallery = usePrewarmedGallery(quickPreview.open, quickPreview.onClose);
  const batchRename = useBatchRenameStore((state) => state.session);

  return (
    <>
      <AboutModal {...about} />
      <ContextMenu {...contextMenu} />
      {conversionMounted ? (
        <Suspense fallback={null}>
          <LazyConversionModal {...conversion} />
        </Suspense>
      ) : null}
      {batchRename ? (
        <BatchRenameDialog
          items={batchRename.items}
          onApply={batchRename.onApply}
          onClose={() => useBatchRenameStore.getState().close(batchRename)}
        />
      ) : null}
      <PromptModal />
      {settingsMounted ? (
        <Suspense fallback={null}>
          <LazySettingsOverlay {...settings} />
        </Suspense>
      ) : null}
      <IndexedSearchModal {...indexedSearch} previewOpen={quickPreview.open} />
      <QuickMoveOverlay />
      <TooltipDisplay />
      {Gallery && quickPreview.open ? <Gallery {...quickPreview} /> : null}
    </>
  );
};
