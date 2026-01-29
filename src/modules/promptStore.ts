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
};

type PromptStore = {
  prompt: PromptConfig | null;
  showPrompt: (prompt: PromptConfig) => void;
  hidePrompt: () => void;
};

export const usePromptStore = createWithEqualityFn<PromptStore>((set) => ({
  prompt: null,
  showPrompt: (prompt) => set({ prompt }),
  hidePrompt: () => set({ prompt: null }),
}));
