// A remote file gesture stays inside the app; remote paths are never passed to Windows as local files.
import { create } from "zustand";
import type { DropTarget } from "@/lib/dropTarget";

export const useRemoteDrag = create<{ target: DropTarget | null; remoteTarget: DropTarget | null }>(() => ({ target: null, remoteTarget: null }));
