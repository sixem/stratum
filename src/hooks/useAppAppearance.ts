// Syncs UI appearance settings onto root data attributes.
import { useEffect } from "react";
import type { AccentTheme } from "@/modules";

type AppAppearanceOptions = {
  accentTheme: AccentTheme;
  ambientBackground: boolean;
  blurOverlays: boolean;
  gridRounded: boolean;
  gridCentered: boolean;
};

export const useAppAppearance = ({
  accentTheme,
  ambientBackground,
  blurOverlays,
  gridRounded,
  gridCentered,
}: AppAppearanceOptions) => {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = accentTheme;
    root.dataset.ambient = ambientBackground ? "true" : "false";
    root.dataset.blurOverlays = blurOverlays ? "true" : "false";
    root.dataset.gridCorners = gridRounded ? "rounded" : "straight";
    root.dataset.gridCenter = gridCentered ? "true" : "false";
  }, [accentTheme, ambientBackground, blurOverlays, gridRounded, gridCentered]);
};
