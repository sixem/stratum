// Render the editable fields for the active rename method.
import type { RefObject } from "react";
import { DropdownSelect, PressButton } from "@/components/primitives";
import {
  BATCH_RENAME_MAX_DIGITS, BATCH_RENAME_NUMBER_STYLES, BATCH_RENAME_OCCURRENCES,
  DEFAULT_BATCH_RENAME_NUMBERING, type BatchRenameNumbering, type BatchRenameRule,
} from "@/lib/batchRename";
import { BatchRenameInput } from "./BatchRenameInput";

const POSITIONS = [{ id: "number-position", options: [{ value: "before", label: "Before name" }] }];
const STYLES = [{ id: "number-style", options: [
  { value: "space", label: "Space" },
  { value: "dash", label: "Hyphen" },
  { value: "underscore", label: "Underscore" },
] }];
const OCCURRENCES = [{ id: "replace-occurrence", options: [
  { value: "first", label: "First match" },
  { value: "last", label: "Last match" },
] }];

const NUMBER_FIELDS = [
  { key: "start", caption: "Start at", min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: "step", caption: "Step", min: 1, max: Number.MAX_SAFE_INTEGER },
  { key: "digits", caption: "Minimum digits", min: 1, max: BATCH_RENAME_MAX_DIGITS },
] as const;

type Props = {
  rule: BatchRenameRule;
  disabled: boolean;
  initialInputRef: RefObject<HTMLInputElement | null>;
  numberingExpanded: boolean;
  onToggleNumbering: () => void;
  onChange: (rule: BatchRenameRule) => void;
};

export const BatchRenameRuleFields = ({
  rule, disabled, initialInputRef, numberingExpanded, onToggleNumbering, onChange,
}: Props) => {
  switch (rule.mode) {
    case "number": {
      const numbering = rule.numbering ?? DEFAULT_BATCH_RENAME_NUMBERING;
      const setNumbering = (patch: Partial<BatchRenameNumbering>) =>
        onChange({ ...rule, numbering: { ...numbering, ...patch } });
      return (
        <>
          <div className="batch-rename-fields batch-rename-name-row">
            <BatchRenameInput caption="Base name" ref={initialInputRef} value={rule.baseName}
              onChange={(event) => onChange({ ...rule, baseName: event.currentTarget.value })} />
            <PressButton type="button" className="btn ghost" aria-expanded={numberingExpanded} onClick={onToggleNumbering}>
              Numbering options
            </PressButton>
          </div>
          {numberingExpanded ? (
            <>
              <div className="batch-rename-number-fields" role="group" aria-label="Numbering options">
                {NUMBER_FIELDS.map(({ key, caption, min, max }) => (
                  <BatchRenameInput key={key} caption={caption} className="tnum" type="number" min={min} max={max} step={1}
                    value={Number.isNaN(numbering[key]) ? "" : numbering[key]}
                    onChange={(event) => setNumbering({ [key]: event.currentTarget.valueAsNumber })} />
                ))}
                <div className="batch-rename-field">
                  <span>Position</span>
                  <DropdownSelect ariaLabel="Number position" groups={POSITIONS} placeholder="After name"
                    value={numbering.position === "before" ? "before" : null} disabled={disabled}
                    onChange={(position) => setNumbering({ position: position === "before" ? "before" : "after" })} />
                </div>
                <div className="batch-rename-field">
                  <span>Number style</span>
                  <DropdownSelect ariaLabel="Number style" groups={STYLES} placeholder="Parentheses"
                    value={numbering.style === "parentheses" ? null : numbering.style} disabled={disabled}
                    onChange={(value) => setNumbering({ style: BATCH_RENAME_NUMBER_STYLES.find((style) => style === value) ?? "parentheses" })} />
                </div>
              </div>
              <div className="batch-rename-checks">
                <label>
                  <input type="checkbox" checked={numbering.numberFirst}
                    onChange={(event) => setNumbering({ numberFirst: event.currentTarget.checked })} />
                  Number the first item
                </label>
              </div>
            </>
          ) : null}
        </>
      );
    }
    case "replace":
      return (
        <div className="batch-rename-fields">
          <BatchRenameInput caption="Find" value={rule.find}
            onChange={(event) => onChange({ ...rule, find: event.currentTarget.value })} />
          <BatchRenameInput caption="Replace with" value={rule.replacement}
            onChange={(event) => onChange({ ...rule, replacement: event.currentTarget.value })} />
          <div className="batch-rename-field">
            <span>Replace matches</span>
            <DropdownSelect ariaLabel="Replace matches" groups={OCCURRENCES} placeholder="Every match"
              value={rule.occurrence && rule.occurrence !== "all" ? rule.occurrence : null} disabled={disabled}
              onChange={(value) => onChange({ ...rule, occurrence: BATCH_RENAME_OCCURRENCES.find((option) => option === value) ?? "all" })} />
          </div>
        </div>
      );
    case "affix":
      return (
        <div className="batch-rename-fields">
          <BatchRenameInput caption="Prefix" value={rule.prefix}
            onChange={(event) => onChange({ ...rule, prefix: event.currentTarget.value })} />
          <BatchRenameInput caption="Suffix" value={rule.suffix}
            onChange={(event) => onChange({ ...rule, suffix: event.currentTarget.value })} />
        </div>
      );
  }
};
