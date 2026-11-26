import { create } from "zustand";
import type { LinkedPane } from "@/lib/paneLink";

type Summary = { countLabel: string; selectionLabel: string; message: string; level: "error" | "idle" | "loading" };
export const useRemoteStatus = create<Record<LinkedPane, Summary | null>>(() => ({ main: null, bottom: null }));
