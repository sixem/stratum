// Small UI store for the indexed-search modal.
//
// Keeping this separate from the main shell model lets us add the first modal
// shell and keybind without threading temporary state through the larger app
// composition tree.
import { createWithEqualityFn } from "zustand/traditional";

type IndexedSearchUiStore = {
  open: boolean;
  query: string;
  openModal: () => void;
  closeModal: () => void;
  toggleModal: () => void;
  setQuery: (query: string) => void;
  resetQuery: () => void;
};

export const useIndexedSearchUiStore = createWithEqualityFn<IndexedSearchUiStore>((set) => ({
  open: false,
  query: "",
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false, query: "" }),
  toggleModal: () =>
    set((state) => ({
      open: !state.open,
      query: state.open ? "" : state.query,
    })),
  setQuery: (query) => set({ query }),
  resetQuery: () => set({ query: "" }),
}));
