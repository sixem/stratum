// Syncs UI appearance settings onto root data attributes.
import { useLayoutEffect } from "react";
import type { AccentTheme } from "@/modules";

type AppAppearanceOptions = {
  accentTheme: AccentTheme;
  darkMode: boolean;
  ambientBackground: boolean;
  blurOverlays: boolean;
  gridRounded: boolean;
  gridCentered: boolean;
};

export const useAppAppearance = ({
  accentTheme,
  darkMode,
  ambientBackground,
  blurOverlays,
  gridRounded,
  gridCentered,
}: AppAppearanceOptions) => {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = accentTheme;
    root.dataset.darkMode = darkMode ? "true" : "false";
    root.dataset.ambient = ambientBackground ? "true" : "false";
    root.dataset.blurOverlays = blurOverlays ? "true" : "false";
    root.dataset.gridCorners = gridRounded ? "rounded" : "straight";
    root.dataset.gridCenter = gridCentered ? "true" : "false";
  }, [accentTheme, darkMode, ambientBackground, blurOverlays, gridRounded, gridCentered]);
};
