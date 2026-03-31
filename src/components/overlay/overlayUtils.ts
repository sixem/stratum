// Shared overlay geometry helpers for viewport-aware menus, tooltips, and popovers.
// These stay small on purpose so overlay components can compose only the pieces they need.

export const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const getViewportSize = () => {
  const root = document.documentElement;
  return {
    width: root.clientWidth,
    height: root.clientHeight,
  };
};

// Positions a floating surface around a point, preferring the "after" side first,
// then flipping to the "before" side, and finally clamping within the viewport.
export const alignFloatingAxis = (
  anchor: number,
  size: number,
  viewport: number,
  edge: number,
  gap: number,
) => {
  const available = viewport - edge * 2;
  if (available <= 0 || size >= available) {
    return edge;
  }

  const minStart = edge;
  const maxStart = viewport - edge - size;

  if (anchor + gap + size <= viewport - edge) {
    return anchor + gap;
  }
  if (anchor - gap - size >= edge) {
    return anchor - gap - size;
  }

  return clamp(anchor - size / 2, minStart, maxStart);
};

// Clamps a left/top start coordinate while preserving the caller's preferred alignment.
export const clampOverlayStart = (
  start: number,
  size: number,
  viewport: number,
  edge: number,
) => {
  const maxStart = Math.max(edge, viewport - edge - size);
  return clamp(start, edge, maxStart);
};

type PopoverVerticalPlacementOptions = {
  anchorTop: number;
  anchorBottom: number;
  overlayHeight: number;
  viewportHeight: number;
  edge: number;
  gap: number;
  minHeight: number;
};

// Resolves dropdown-style vertical placement anchored to a control edge.
export const resolvePopoverVerticalPlacement = ({
  anchorTop,
  anchorBottom,
  overlayHeight,
  viewportHeight,
  edge,
  gap,
  minHeight,
}: PopoverVerticalPlacementOptions) => {
  const spaceBelow = viewportHeight - anchorBottom - edge;
  const spaceAbove = anchorTop - edge;
  const dropUp = overlayHeight > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = Math.max(minHeight, (dropUp ? spaceAbove : spaceBelow) - gap);
  const usedHeight = Math.min(overlayHeight, maxHeight);
  const top = dropUp
    ? Math.max(edge, anchorTop - gap - usedHeight)
    : Math.min(viewportHeight - edge - usedHeight, anchorBottom + gap);

  return {
    dropUp,
    maxHeight,
    top,
  };
};
