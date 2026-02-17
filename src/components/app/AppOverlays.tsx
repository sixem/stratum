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

const useDeferredMount = (open: boolean) => {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

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
  const conversionMounted = useDeferredMount(conversion.open);
  const settingsMounted = useDeferredMount(settings.open);
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
