// Groups overlay layers to keep App render structure small and explicit.
import type { ComponentProps } from "react";
import { AboutModal } from "@/components/overlay/AboutModal";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { PromptModal } from "@/components/overlay/PromptModal";
import { QuickPreviewOverlay } from "@/components/preview/QuickPreviewOverlay";
import { SettingsOverlay } from "@/components/overlay/SettingsOverlay";
import { TooltipDisplay } from "@/components/overlay/Tooltip";

type AppOverlaysProps = {
  about: ComponentProps<typeof AboutModal>;
  contextMenu: ComponentProps<typeof ContextMenu>;
  quickPreview: ComponentProps<typeof QuickPreviewOverlay>;
  settings: ComponentProps<typeof SettingsOverlay>;
};

export const AppOverlays = ({
  about,
  contextMenu,
  quickPreview,
  settings,
}: AppOverlaysProps) => {
  return (
    <>
      <AboutModal {...about} />
      <ContextMenu {...contextMenu} />
      <PromptModal />
      <SettingsOverlay {...settings} />
      <TooltipDisplay />
      <QuickPreviewOverlay {...quickPreview} />
    </>
  );
};
