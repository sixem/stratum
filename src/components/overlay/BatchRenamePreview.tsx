// Keep large selections responsive by only rendering the visible preview rows.
import { useRef } from "react";
import { ScrollArea } from "@/components/primitives";
import { useVirtualRange } from "@/hooks/perf/scroll/useVirtualRange";
import type { BatchRenamePreviewRow } from "@/lib/batchRename";

const ROW_HEIGHT = 44;

type BatchRenamePreviewProps = {
  rows: readonly BatchRenamePreviewRow[];
  diskErrors?: ReadonlyMap<string, string>;
};

export const BatchRenamePreview = ({ rows, diskErrors }: BatchRenamePreviewProps) => {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const range = useVirtualRange(previewRef, rows.length, ROW_HEIGHT);

  return (
    <div className="batch-rename-preview" role="table" aria-label="Rename preview" aria-rowcount={rows.length + 1}>
      <div className="batch-rename-columns batch-rename-preview-head" role="row" aria-rowindex={1}>
        <div role="columnheader">Current</div>
        <div role="columnheader">New</div>
      </div>
      <div className="batch-rename-scroll-slot" style={{ height: rows.length * ROW_HEIGHT }}>
        <ScrollArea ref={previewRef} className="batch-rename-scroll" scrollbarVariant="compact">
          <div role="rowgroup" style={{ paddingTop: range.offsetTop, paddingBottom: range.offsetBottom }}>
            {rows.slice(range.startIndex, range.endIndex).map(({ item, nextName, error }, index) => {
              const detail = error ?? diskErrors?.get(item.path);
              return (
                <div
                  className="batch-rename-columns batch-rename-preview-row"
                  role="row"
                  aria-rowindex={range.startIndex + index + 2}
                  data-changed={nextName !== item.name}
                  key={item.path}
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="batch-rename-filename" role="cell">{item.name}</div>
                  <div role="cell">
                    <div className="batch-rename-filename">{nextName || "—"}</div>
                    {detail ? <div className="batch-rename-error">{detail}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
