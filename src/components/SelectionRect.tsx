// Visual overlay for drag selection.
import type { SelectionBox } from "@/hooks";

type SelectionRectProps = {
  box: SelectionBox | null;
};

export const SelectionRect = ({ box }: SelectionRectProps) => {
  if (!box) return null;
  return (
    <div
      className="selection-rect"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      aria-hidden="true"
    />
  );
};
