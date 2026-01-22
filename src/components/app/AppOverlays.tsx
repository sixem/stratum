// Groups overlay layers to keep App render structure small and explicit.
import type { ComponentProps } from "react";
import { ContextMenu } from "@/components/ContextMenu";
import { PromptModal } from "@/components/PromptModal";
import { SettingsOverlay } from "@/components/SettingsOverlay";
import { TooltipDisplay } from "@/components/Tooltip";

type AppOverlaysProps = {
  contextMenu: ComponentProps<typeof ContextMenu>;
  settings: ComponentProps<typeof SettingsOverlay>;
};

export const AppOverlays = ({ contextMenu, settings }: AppOverlaysProps) => {
  return (
    <>
      <ContextMenu {...contextMenu} />
      <PromptModal />
      <SettingsOverlay {...settings} />
      <TooltipDisplay />
    </>
  );
};
