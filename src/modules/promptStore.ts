// Prompt modal state for confirmations and alerts.
import type { ReactNode } from "react";
import { createWithEqualityFn } from "zustand/traditional";

export type PromptConfig = {
  title?: string;
  content: ReactNode;
  footerNote?: string;
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
  // Wait for the active prompt and keep later requests behind this one.
  queued?: boolean;
  aboveOverlays?: boolean;
};

type PromptStore = {
  prompt: PromptConfig | null;
  pending: PromptConfig[];
  showPrompt: (prompt: PromptConfig) => void;
  hidePrompt: (expected?: PromptConfig) => boolean;
};

export const usePromptStore = createWithEqualityFn<PromptStore>((set, get) => ({
  prompt: null,
  pending: [],
  showPrompt: (prompt) => {
    const { prompt: previous, pending } = get();
    if (previous === prompt || pending.includes(prompt)) return;
    if (previous && (previous.queued || prompt.queued || pending.length)) {
      set({ pending: [...pending, prompt] });
      return;
    }
    set({ prompt });
    // Conflict and confirmation callers may be awaiting the old decision.
    previous?.onCancel?.();
  },
  hidePrompt: (expected) => {
    const { prompt: current, pending } = get();
    if (expected && expected !== current) {
      // A background operation can finish before its dialog becomes visible.
      if (!pending.includes(expected)) return false;
      set({ pending: pending.filter(prompt => prompt !== expected) });
      return true;
    }
    if (!current) return false;
    set({ prompt: pending[0] ?? null, pending: pending.slice(1) });
    return true;
  },
}));
