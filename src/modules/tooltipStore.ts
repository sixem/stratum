// Centralized tooltip state for hover and focus interactions.
import { create } from "zustand";
import { clampTooltipDelay, DEFAULT_TOOLTIP_DELAY_MS } from "@/constants";

type TooltipState = {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  tooltipDelay: number;
  tooltipElement: HTMLDivElement | null;
  nonce: number;
  blockUntilPointerMove: boolean;
};

type TooltipCoords = {
  text: string;
  x: number;
  y: number;
};

type TooltipStore = TooltipState & {
  setTooltipElement: (element: HTMLDivElement | null) => void;
  setTooltipDelay: (delayMs: number) => void;
  setTooltipText: (text: string) => void;
  showTooltip: (coords: TooltipCoords) => void;
  hideTooltip: () => void;
  blockTooltips: () => void;
  clearTooltipBlock: () => void;
};

export const useTooltipStore = create<TooltipStore>((set, _get) => ({
  visible: false,
  text: "",
  x: 0,
  y: 0,
  tooltipDelay: DEFAULT_TOOLTIP_DELAY_MS,
  tooltipElement: null,
  nonce: 0,
  blockUntilPointerMove: false,
  setTooltipElement: (element) => set({ tooltipElement: element }),
  setTooltipDelay: (delayMs) => set({ tooltipDelay: clampTooltipDelay(delayMs) }),
  setTooltipText: (text) =>
    set((state) => {
      if (state.text === text) return state;
      return { ...state, text };
    }),
  showTooltip: ({ text, x, y }) =>
    set({
      visible: true,
      text,
      x,
      y,
    }),
  hideTooltip: () =>
    set((state) => {
      const nextNonce = state.nonce + 1;
      if (!state.visible && !state.text) {
        return { ...state, nonce: nextNonce };
      }
      return { ...state, visible: false, text: "", nonce: nextNonce };
    }),
  blockTooltips: () => set({ blockUntilPointerMove: true }),
  clearTooltipBlock: () => set({ blockUntilPointerMove: false }),
}));
