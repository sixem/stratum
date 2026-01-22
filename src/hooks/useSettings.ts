// Exposes the settings store as a hook for components.
import { useSettingsStore } from "@/modules";

export const useSettings = () => {
  return useSettingsStore((state) => state);
};
