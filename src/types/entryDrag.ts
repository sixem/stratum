// Pointer information available when an entry gesture becomes a drag.
export type EntryDragStart = {
  x: number;
  y: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export type EntryDragHandler = (paths: string[], folderPath?: string, start?: EntryDragStart) => void;
