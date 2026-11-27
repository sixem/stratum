// A remote file gesture stays inside the app; remote paths are never passed to Windows as local files.
import { create } from "zustand";
import type { DropTarget } from "@/lib/dropTarget";

export type RemoteDragPreview = {
  name: string;
  isDir: boolean;
  count: number;
  x: number;
  y: number;
  action: "copy" | "move" | "unavailable";
};

export const useRemoteDrag = create<{
  target: DropTarget | null;
  remoteTarget: DropTarget | null;
  preview: RemoteDragPreview | null;
}>(() => ({ target: null, remoteTarget: null, preview: null }));
