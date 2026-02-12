// Overlay orchestration for App.tsx: about metadata + consolidated AppOverlays props.
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { AppOverlays } from "@/components";
import { getPlatformLabel } from "@/lib";

type AppOverlaysProps = ComponentProps<typeof AppOverlays>;

type UseAppOverlayControllerOptions = {
  isTauriEnv: boolean;
  appName: string;
  description: string;
  version: string;
  aboutOpen: boolean;
  onCloseAbout: () => void;
  contextMenu: AppOverlaysProps["contextMenu"];
  quickPreview: AppOverlaysProps["quickPreview"];
  settings: AppOverlaysProps["settings"];
};

export const useAppOverlayController = ({
  isTauriEnv,
  appName,
  description,
  version,
  aboutOpen,
  onCloseAbout,
  contextMenu,
  quickPreview,
  settings,
}: UseAppOverlayControllerOptions): AppOverlaysProps => {
  const aboutMeta = useMemo(
    () => ({
      runtime: isTauriEnv ? "Tauri" : "Web",
      platform: getPlatformLabel(),
      buildMode: import.meta.env.MODE ?? "unknown",
    }),
    [isTauriEnv],
  );

  return useMemo(
    () => ({
      about: {
        open: aboutOpen,
        appName,
        description,
        version,
        buildMode: aboutMeta.buildMode,
        runtime: aboutMeta.runtime,
        platform: aboutMeta.platform,
        onClose: onCloseAbout,
      },
      contextMenu,
      quickPreview,
      settings,
    }),
    [
      aboutMeta.buildMode,
      aboutMeta.platform,
      aboutMeta.runtime,
      aboutOpen,
      appName,
      contextMenu,
      description,
      onCloseAbout,
      quickPreview,
      settings,
      version,
    ],
  );
};

