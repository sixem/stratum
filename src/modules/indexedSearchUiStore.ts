// Small UI store for the indexed-search modal.
//
// Keeping this separate from the main shell model lets us add the first modal
// shell and keybind without threading temporary state through the larger app
// composition tree.
import { createWithEqualityFn } from "zustand/traditional";

type OpenFolderInAppHandler = (path: string) => void;

type IndexedSearchUiStore = {
  open: boolean;
  query: string;
  openFolderInApp: OpenFolderInAppHandler | null;
  openModal: () => void;
  closeModal: () => void;
  toggleModal: () => void;
  setOpenFolderInApp: (handler: OpenFolderInAppHandler | null) => void;
  setQuery: (query: string) => void;
  resetQuery: () => void;
};

export const useIndexedSearchUiStore = createWithEqualityFn<IndexedSearchUiStore>((set) => ({
  open: false,
  query: "",
  openFolderInApp: null,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false, query: "" }),
  toggleModal: () =>
    set((state) => ({
      open: !state.open,
      query: state.open ? "" : state.query,
    })),
  setOpenFolderInApp: (handler) => set({ openFolderInApp: handler }),
  setQuery: (query) => set({ query }),
  resetQuery: () => set({ query: "" }),
}));
