// Overlay section container for App.tsx.
// Converts section-level inputs into the consolidated AppOverlays prop shape.
import type { ComponentProps } from "react";
import { AppOverlays } from "@/components";
import { useAppOverlayController } from "./useAppOverlayController";

type AppOverlaysProps = ComponentProps<typeof AppOverlays>;

type UseAppOverlaySectionOptions = {
  appMeta: {
    isTauriEnv: boolean;
    appName: string;
    description: string;
    version: string;
  };
  about: {
    open: boolean;
    onClose: () => void;
  };
  contextMenu: {
    state: { x: number; y: number } | null;
    open: boolean;
    items: AppOverlaysProps["contextMenu"]["items"];
    onClose: () => void;
  };
  quickPreview: AppOverlaysProps["quickPreview"];
  settings: AppOverlaysProps["settings"];
  conversion: AppOverlaysProps["conversion"];
};

export const useAppOverlaySection = ({
  appMeta,
  about,
  contextMenu,
  quickPreview,
  settings,
  conversion,
}: UseAppOverlaySectionOptions): AppOverlaysProps => {
  return useAppOverlayController({
    isTauriEnv: appMeta.isTauriEnv,
    appName: appMeta.appName,
    description: appMeta.description,
    version: appMeta.version,
    aboutOpen: about.open,
    onCloseAbout: about.onClose,
    contextMenu: {
      open: contextMenu.open,
      x: contextMenu.state?.x ?? 0,
      y: contextMenu.state?.y ?? 0,
      items: contextMenu.items,
      onClose: contextMenu.onClose,
    },
    conversion,
    quickPreview,
    settings,
  });
};
