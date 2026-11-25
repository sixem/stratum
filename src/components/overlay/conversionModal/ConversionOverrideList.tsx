// Mount override editors only around the visible portion of the conversion list.
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { DropdownSelect, PressButton } from "@/components/primitives";
import type {
  ConversionItemDraft,
  ConversionModalDraft,
  ConversionRunState,
} from "@/types";
import {
  ITEM_STATUS_LABELS,
  describeAppliedFormat,
  findRuleFormat,
  overrideGroupsByKind,
} from "./conversionModalConfig";
import { CONVERSION_OVERRIDE_ROW_HEIGHT, useConversionOverrideWindow } from "./useConversionOverrideWindow";

type ConversionOverrideListProps = {
  draft: ConversionModalDraft;
  runState: ConversionRunState | null;
  sortedOverrideItems: ConversionItemDraft[];
  titleId: string;
  expandedOverridePath: string | null;
  runInProgress: boolean;
  onOverrideToggle: (itemPath: string) => void;
  onOverrideFormatChange: (itemPath: string, targetFormat: string | null) => void;
};

export const ConversionOverrideList = ({
  draft,
  runState,
  sortedOverrideItems,
  titleId,
  expandedOverridePath,
  runInProgress,
  onOverrideToggle,
  onOverrideFormatChange,
}: ConversionOverrideListProps) => {
  const itemCount = sortedOverrideItems.length;
  const expandedIndex = useMemo(
    () => expandedOverridePath ? sortedOverrideItems.findIndex(({ path }) => path === expandedOverridePath) : -1,
    [expandedOverridePath, sortedOverrideItems],
  );
  const { listRef, expandedRowRef, start, end, extraHeight } = useConversionOverrideWindow(itemCount, expandedIndex);
  const indexes = Array.from({ length: end - start }, (_, index) => start + index);
  // Keep the expanded row measurable when scrolled out of the window.
  if (expandedIndex >= 0 && expandedIndex < start) indexes.unshift(expandedIndex);
  if (expandedIndex >= end) indexes.push(expandedIndex);
  const listStyle = {
    "--conversion-override-row-height": `${CONVERSION_OVERRIDE_ROW_HEIGHT}px`,
    height: itemCount * CONVERSION_OVERRIDE_ROW_HEIGHT + extraHeight,
  } as CSSProperties;

  return (
    <div className="conversion-block">
      <div className="conversion-override-shell">
        <div className="conversion-override-shell-head">
          <div className="conversion-section-label">To process</div>
          <span className="conversion-override-count">
            <span className="tnum">{itemCount}</span>{" "}
            item{itemCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="conversion-override-list" ref={listRef} style={listStyle} role="list" aria-label="Override target items">
          {indexes.map((index) => {
            const item = sortedOverrideItems[index];
            if (!item) return null;
            const defaultFormat = findRuleFormat(draft, item.kind);
            const appliedFormat = item.override?.targetFormat ?? defaultFormat;
            const appliedFormatDisplay = describeAppliedFormat(appliedFormat);
            const itemStatus = runState?.itemStatusByPath[item.path] ?? "idle";
            const itemStatusLabel = ITEM_STATUS_LABELS[itemStatus];
            const showItemStatus = itemStatus !== "idle";
            const isActive = expandedIndex === index;
            const hasOverride = Boolean(item.override?.targetFormat);
            const editorId = `${titleId}-override-${index}`;

            return (
              <div
                key={item.path}
                className={`conversion-override-item${isActive ? " is-active" : ""}${
                  hasOverride ? " is-overridden" : ""
                }`}
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={itemCount}
                inert={index < start || index >= end}
                data-last={index === itemCount - 1 || undefined}
                ref={isActive ? expandedRowRef : undefined}
                style={{ top: index * CONVERSION_OVERRIDE_ROW_HEIGHT + (expandedIndex < index ? extraHeight : 0) }}
              >
                <PressButton
                  type="button"
                  className="conversion-override-trigger"
                  aria-expanded={isActive}
                  aria-controls={editorId}
                  onClick={() => onOverrideToggle(item.path)}
                  disabled={runInProgress}
                >
                  <span className="conversion-override-name">{item.name}</span>
                  <span className="conversion-override-right">
                    {showItemStatus ? (
                      <span className={`conversion-item-status is-${itemStatus}`}>
                        {itemStatusLabel}
                      </span>
                    ) : null}
                    <span className="conversion-override-summary">
                      {appliedFormatDisplay.summary}
                    </span>
                  </span>
                </PressButton>
                {isActive ? (
                  <div className="conversion-override-editor" id={editorId}>
                    <div className="conversion-override-editor-head">
                      <span className="conversion-override-editor-label">
                        Target format override
                      </span>
                      <PressButton
                        type="button"
                        className="btn ghost conversion-clear-override"
                        onClick={() => onOverrideFormatChange(item.path, null)}
                        disabled={!item.override?.targetFormat || runInProgress}
                      >
                        Use type default
                      </PressButton>
                    </div>
                    <DropdownSelect
                      value={item.override?.targetFormat ?? null}
                      groups={overrideGroupsByKind[item.kind]}
                      placeholder="Choose target format"
                      ariaLabel={`Override format for ${item.name}`}
                      className="conversion-override-select"
                      menuClassName="conversion-override-select-menu"
                      onChange={(next) => onOverrideFormatChange(item.path, next)}
                      disabled={runInProgress}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
