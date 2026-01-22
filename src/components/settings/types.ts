// Shared types for settings panel subcomponents.
import type { Settings } from "@/modules";

export type SettingsUpdateHandler = (patch: Partial<Settings>) => void;
