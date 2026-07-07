// Drive-list presentation and measurement for indexed search.
//
// The component measures the widest drive label after render so rows align
// without hard-coding path widths for different machines.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { PressButton, ScrollArea } from "@/components/primitives";
import { formatIndexedDriveSummary } from "@/lib";
import type { IndexedDriveStatus } from "@/types";
import { IndexedDriveStateBadge } from "./IndexedDriveStateBadge";
import {
  normalizeDrivePathKey,
  type IndexedSelection,
} from "./indexedSearchModalTypes";

type IndexedSearchDriveListProps = {
  driveStatuses: IndexedDriveStatus[];
  onSelectDrive: (drivePath: string) => void;
  open: boolean;
  selection: IndexedSelection | null;
  statusLoading: boolean;
};

export const IndexedSearchDriveList = ({
  driveStatuses,
  onSelectDrive,
  open,
  selection,
  statusLoading,
}: IndexedSearchDriveListProps) => {
  const drivePathRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [driveLabelColumnWidth, setDriveLabelColumnWidth] = useState<number | null>(null);

  useEffect(() => {
    drivePathRefs.current.length = driveStatuses.length;
  }, [driveStatuses.length]);

  useEffect(() => {
    if (!open || driveStatuses.length === 0) {
      setDriveLabelColumnWidth(null);
      return;
    }

    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (cancelled) return;

      const nextWidth = drivePathRefs.current.reduce((maxWidth, element) => {
        if (!element) return maxWidth;
        return Math.max(maxWidth, Math.ceil(element.getBoundingClientRect().width));
      }, 0);

      setDriveLabelColumnWidth(nextWidth > 0 ? nextWidth : null);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [driveStatuses, open]);

  const driveLabelColumnStyle =
    driveLabelColumnWidth != null
      ? ({
          ["--indexed-search-drive-label-width" as const]: `${driveLabelColumnWidth}px`,
        } as CSSProperties)
      : undefined;
  const driveStatusMetaLabel =
    statusLoading && driveStatuses.length === 0 ? "Loading..." : `${driveStatuses.length} drives`;

  return (
    <>
      <div className="indexed-search-subsection-head">
        <div className="indexed-search-section-title">Drives</div>
        <div className="indexed-search-section-meta">{driveStatusMetaLabel}</div>
      </div>

      {driveStatuses.length === 0 ? (
        <div className="indexed-search-selection-detail-empty">
          No indexed drive data available yet.
        </div>
      ) : (
        <ScrollArea
          className="indexed-search-scroll"
          viewportClassName="indexed-search-scroll-viewport"
          contentClassName="indexed-search-scroll-content indexed-search-drive-list"
          scrollbarVariant="overlay"
        >
          {driveStatuses.map((status, index) => {
            const isSelected =
              selection?.kind === "drive" &&
              normalizeDrivePathKey(selection.drivePath) ===
                normalizeDrivePathKey(status.drivePath);
            const statusSummary = formatIndexedDriveSummary(status);

            return (
              <PressButton
                key={status.drivePath}
                type="button"
                className={`indexed-search-drive${isSelected ? " is-selected" : ""}`}
                style={driveLabelColumnStyle}
                pressOnPointerDown={false}
                onClick={() => onSelectDrive(status.drivePath)}
              >
                <div className="indexed-search-drive-head">
                  <div className="indexed-search-drive-copy">
                    <span
                      className="indexed-search-drive-path"
                      ref={(element) => {
                        drivePathRefs.current[index] = element;
                      }}
                    >
                      {status.drivePath}
                    </span>
                    <span className="indexed-search-drive-meta">
                      {statusSummary ??
                        (status.filesystem ? `FS: ${status.filesystem}` : "FS unavailable")}
                    </span>
                  </div>
                  <IndexedDriveStateBadge state={status.state} />
                </div>
              </PressButton>
            );
          })}
        </ScrollArea>
      )}
    </>
  );
};
