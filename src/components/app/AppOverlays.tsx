// Groups overlay layers to keep App render structure small and explicit.
import { Suspense, lazy, useEffect, useState } from "react";
import { AboutModal } from "@/components/overlay/AboutModal";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { PromptModal } from "@/components/overlay/PromptModal";
import { TooltipDisplay } from "@/components/overlay/Tooltip";
import type { ConversionModalProps } from "@/components/overlay/ConversionModal";
import type { SettingsOverlayProps } from "@/components/overlay/SettingsOverlay";
import type { QuickPreviewOverlayProps } from "@/components/preview/QuickPreviewOverlay";
import type { ComponentProps } from "react";

const LazyConversionModal = lazy(async () => {
  const module = await import("@/components/overlay/ConversionModal");
  return { default: module.ConversionModal };
});

const LazySettingsOverlay = lazy(async () => {
  const module = await import("@/components/overlay/SettingsOverlay");
  return { default: module.SettingsOverlay };
});

const LazyQuickPreviewOverlay = lazy(async () => {
  const module = await import("@/components/preview/QuickPreviewOverlay");
  return { default: module.QuickPreviewOverlay };
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

  return mounted;
};

type AppOverlaysProps = {
  about: ComponentProps<typeof AboutModal>;
  contextMenu: ComponentProps<typeof ContextMenu>;
  conversion: ConversionModalProps;
  quickPreview: QuickPreviewOverlayProps;
  settings: SettingsOverlayProps;
};

export const AppOverlays = ({
  about,
  contextMenu,
  conversion,
  quickPreview,
  settings,
}: AppOverlaysProps) => {
  // Load heavyweight overlays on first use, then keep them mounted.
  const conversionMounted = useDeferredMount(conversion.open, true);
  const settingsMounted = useDeferredMount(settings.open, true);
  const quickPreviewMounted = useDeferredMount(quickPreview.open);

  return (
    <>
      <AboutModal {...about} />
      <ContextMenu {...contextMenu} />
      {conversionMounted ? (
        <Suspense fallback={null}>
          <LazyConversionModal {...conversion} />
        </Suspense>
      ) : null}
      <PromptModal />
      {settingsMounted ? (
        <Suspense fallback={null}>
          <LazySettingsOverlay {...settings} />
        </Suspense>
      ) : null}
      <TooltipDisplay />
      {quickPreviewMounted ? (
        <Suspense fallback={null}>
          <LazyQuickPreviewOverlay {...quickPreview} />
        </Suspense>
      ) : null}
    </>
  );
};
