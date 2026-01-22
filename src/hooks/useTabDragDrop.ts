import type { DragEvent } from "react";
import { useEffect, useState } from "react";

type UseTabDragDropOptions = {
  tabCount: number;
  onReorder: (fromId: string, toIndex: number) => void;
};

export const useTabDragDrop = ({ tabCount, onReorder }: UseTabDragDropOptions) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!draggingId) {
      setDropIndex(null);
    }
  }, [draggingId]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggingId(id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (!draggingId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    const nextIndex = insertAfter ? index + 1 : index;
    setDropIndex(nextIndex);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingId || dropIndex == null) return;
    event.preventDefault();
    onReorder(draggingId, dropIndex);
    setDraggingId(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropIndex(null);
  };

  const handleContainerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setDropIndex(tabCount);
  };

  return {
    draggingId,
    dropIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleContainerDragOver,
  };
};
