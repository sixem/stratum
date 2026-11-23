// Keep folder rows virtualized through multiple pages while retaining the
// active row in the DOM for the search field's aria-activedescendant.
import { useEffect, useLayoutEffect, useMemo } from "react";
import type { RefObject } from "react";
import { ContextOpenFolderIcon } from "@/components/icons/contextMenuIcons";
import { PressButton, ScrollArea } from "@/components/primitives";
import { useVirtualRange } from "@/hooks/perf/scroll/useVirtualRange";
import { TooltipWrapper } from "../Tooltip";
import type { QuickMoveDestination, QuickMoveSection } from "./quickMoveDestinations";

const ROW_STRIDE = 44;
const HEADING_HEIGHT = 23;

const layoutRows = (destinations: QuickMoveDestination[]) => {
  const headings: { section: QuickMoveSection; top: number }[] = [];
  let top = 0;
  let section: QuickMoveSection | undefined;
  const rows = destinations.map((destination, index) => {
    if (destination.section !== section) {
      section = destination.section;
      headings.push({ section, top });
      top += HEADING_HEIGHT;
    }
    const row = { destination, index, top };
    top += ROW_STRIDE;
    return row;
  });
  return { headings, rows, height: top };
};

type QuickMoveResultsProps = {
  destinations: QuickMoveDestination[];
  viewportRef: RefObject<HTMLDivElement | null>;
  resultsId: string;
  activeIndex: number;
  keyboardPath: string | null;
  busy: boolean;
  emptyMessage: string;
  autoPage: boolean;
  onLoadMore: () => void;
  onChoose: (destination: QuickMoveDestination) => void;
  onActivate: (destination: QuickMoveDestination) => void;
  onToggleFavorite: (destination: QuickMoveDestination) => void;
};

export const quickMoveResultId = (resultsId: string, index: number) => `${resultsId}-row-${index}`;

export const QuickMoveResults = ({
  destinations, viewportRef, resultsId, activeIndex, keyboardPath, busy, emptyMessage,
  autoPage, onLoadMore, onChoose, onActivate, onToggleFavorite,
}: QuickMoveResultsProps) => {
  const { headings, rows, height } = useMemo(() => layoutRows(destinations), [destinations]);
  // The viewport has at most three short section headings. Overscan covers the
  // extra offsets, and the exact heading height keeps the total scroll range correct.
  const { startIndex, endIndex } = useVirtualRange(
    viewportRef, rows.length, ROW_STRIDE, 5, 0, headings.length * HEADING_HEIGHT,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const activeRow = rows[activeIndex];
  if (activeRow && activeIndex < startIndex) visibleRows.unshift(activeRow);
  if (activeRow && activeIndex >= endIndex) visibleRows.push(activeRow);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !activeRow || keyboardPath !== activeRow.destination.key) return;
    const { top } = activeRow;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW_STRIDE > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = top + ROW_STRIDE - viewport.clientHeight;
    }
  }, [activeRow, keyboardPath, viewportRef]);

  useEffect(() => {
    if (autoPage && endIndex >= Math.max(0, rows.length - 4)) onLoadMore();
  }, [autoPage, endIndex, onLoadMore, rows.length]);

  return (
    <ScrollArea ref={viewportRef} className="quick-move-scroll" scrollbarVariant="overlay">
      <div id={resultsId} role="grid" aria-label="Move destinations" aria-busy={busy}
        className="quick-move-results" style={{ height }}>
        {headings.map(({ section, top }) => (
          <div key={section} role="presentation" className="quick-move-section" style={{ top }}>{section}</div>
        ))}
        {visibleRows.map(({ destination, index, top }) => {
          const { key, name, path, favorite, disabled } = destination;
          const active = index === activeIndex;
          const starLabel = favorite ? "Remove from favourites" : "Add to favourites";
          return (
            <div key={key} id={quickMoveResultId(resultsId, index)} role="row" aria-selected={active}
              className="quick-move-row" data-active={active || undefined} style={{ top }}>
              <div role="gridcell" className="quick-move-destination-cell">
                <TooltipWrapper text={path}>
                  <PressButton type="button" className="quick-move-destination" tabIndex={-1}
                    pressOnPointerDown={false} disabled={busy || disabled}
                    onPointerEnter={() => onActivate(destination)}
                    onClick={() => onChoose(destination)}>
                    <ContextOpenFolderIcon className="quick-move-folder-icon" />
                    <span className="quick-move-destination-label">
                      <span className="quick-move-name">{name}</span>
                      <span className="quick-move-path">{path}</span>
                    </span>
                  </PressButton>
                </TooltipWrapper>
              </div>
              <div role="gridcell">
                <TooltipWrapper text={starLabel}>
                  <PressButton type="button" className="quick-move-star" aria-label={starLabel}
                    aria-pressed={favorite} tabIndex={active ? 0 : -1} disabled={busy}
                    pressOnPointerDown={false} onClick={() => onToggleFavorite(destination)}>
                    <svg viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"}
                      stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                      <path d="m12 3 2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.35 6.38 20.3l1.07-6.27L2.9 9.6l6.3-.9L12 3Z" />
                    </svg>
                  </PressButton>
                </TooltipWrapper>
              </div>
            </div>
          );
        })}
      </div>
      {!rows.length && emptyMessage ? <p className="quick-move-empty" role="status">{emptyMessage}</p> : null}
    </ScrollArea>
  );
};
