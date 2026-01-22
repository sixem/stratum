// Prompt modal state for confirmations and alerts.
import type { ReactNode } from "react";
import { create } from "zustand";

export type PromptConfig = {
  title?: string;
  content: ReactNode;
  confirmLabel?: string | null;
  cancelLabel?: string | null;
  onConfirm?: () => void;
  onCancel?: () => void;
  blocking?: boolean;
};

type PromptStore = {
  prompt: PromptConfig | null;
  showPrompt: (prompt: PromptConfig) => void;
  hidePrompt: () => void;
};

export const usePromptStore = create<PromptStore>((set) => ({
  prompt: null,
  showPrompt: (prompt) => set({ prompt }),
  hidePrompt: () => set({ prompt: null }),
}));
