// Prompt modal state for confirmations and alerts.
import type { ReactNode } from "react";
import { createWithEqualityFn } from "zustand/traditional";

export type PromptConfig = {
  title?: string;
  content: ReactNode;
  confirmLabel?: string | null;
  cancelLabel?: string | null;
  // Optional extra actions rendered alongside the confirm/cancel buttons.
  actions?: {
    label: string;
    onClick: () => void;
    variant?: "primary" | "ghost";
    closeOnClick?: boolean;
  }[];
  onConfirm?: () => void;
  onCancel?: () => void;
  blocking?: boolean;
  aboveOverlays?: boolean;
};

type PromptStore = {
  prompt: PromptConfig | null;
  showPrompt: (prompt: PromptConfig) => void;
  hidePrompt: (expected?: PromptConfig) => boolean;
};

export const usePromptStore = createWithEqualityFn<PromptStore>((set, get) => ({
  prompt: null,
  showPrompt: (prompt) => {
    const previous = get().prompt;
    if (previous === prompt) return;
    set({ prompt });
    // Conflict and confirmation callers may be awaiting the old decision.
    previous?.onCancel?.();
  },
  hidePrompt: (expected) => {
    const current = get().prompt;
    if (!current || (expected && current !== expected)) return false;
    set({ prompt: null });
    return true;
  },
}));
