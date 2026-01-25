// Keeps system availability info (like shells) in a shared store.
import { createWithEqualityFn } from "zustand/traditional";
import type { ShellAvailability } from "@/types";

type ShellState = {
  availability: ShellAvailability | null;
  setAvailability: (availability: ShellAvailability) => void;
};

export const useShellStore = createWithEqualityFn<ShellState>((set) => ({
  availability: null,
  setAvailability: (availability) => set({ availability }),
}));
