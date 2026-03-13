// Per-item override rows for the conversion modal. Each row owns its inline
// editor UI, while the open-state control stays in the parent model hook.
import type { MutableRefObject } from "react";
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

type ConversionOverrideListProps = {
  draft: ConversionModalDraft;
  runState: ConversionRunState | null;
  sortedOverrideItems: ConversionItemDraft[];
  titleId: string;
  expandedOverridePath: string | null;
  overrideItemRefs: MutableRefObject<Map<string, HTMLDivElement>>;
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
  overrideItemRefs,
  runInProgress,
  onOverrideToggle,
  onOverrideFormatChange,
}: ConversionOverrideListProps) => {
  return (
    <div className="conversion-block">
      <div className="conversion-override-shell">
        <div className="conversion-override-shell-head">
          <div className="conversion-section-label">To process</div>
          <span className="conversion-override-count">
            <span className="tnum">{sortedOverrideItems.length}</span>{" "}
            item{sortedOverrideItems.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="conversion-override-list" role="list" aria-label="Override target items">
          {sortedOverrideItems.map((item, index) => {
            const defaultFormat = findRuleFormat(draft, item.kind);
            const appliedFormat = item.override?.targetFormat ?? defaultFormat;
            const appliedFormatDisplay = describeAppliedFormat(appliedFormat);
            const itemStatus = runState?.itemStatusByPath[item.path] ?? "idle";
            const itemStatusLabel = ITEM_STATUS_LABELS[itemStatus];
            const showItemStatus = itemStatus !== "idle";
            const isActive = expandedOverridePath === item.path;
            const hasOverride = Boolean(item.override?.targetFormat);
            const editorId = `${titleId}-override-${index}`;

            return (
              <div
                key={item.path}
                className={`conversion-override-item${isActive ? " is-active" : ""}${
                  hasOverride ? " is-overridden" : ""
                }`}
                role="listitem"
                ref={(node) => {
                  if (node) {
                    overrideItemRefs.current.set(item.path, node);
                    return;
                  }
                  overrideItemRefs.current.delete(item.path);
                }}
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
