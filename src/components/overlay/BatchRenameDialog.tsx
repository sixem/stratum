// Show the proposed names and check them against disk before applying the batch.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { validateBatchRename } from "@/api";
import { PressButton } from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks/ui/app/useModalFocusTrap";
import {
  buildBatchRenamePreview,
  DEFAULT_BATCH_RENAME_NUMBERING,
  isBatchRenameNumberingValid,
  type BatchRenameMode,
  type BatchRenameRequest,
  type BatchRenameRule,
} from "@/lib/batchRename";
import { splitNameExtension } from "@/lib/fileName";
import type { BatchRenamePreset } from "@/modules/batchRenamePresetStore";
import type { EntryContextTarget } from "@/types";
import { BatchRenamePresets } from "./BatchRenamePresets";
import { BatchRenamePreview } from "./BatchRenamePreview";
import { BatchRenameRuleFields } from "./BatchRenameRuleFields";
import { DialogCloseButton } from "./DialogCloseButton";
import { OverlayPanelHeader } from "./OverlayPanelHeader";

const MODES = [
  { id: "number", label: "Name and number" },
  { id: "replace", label: "Find and replace" },
  { id: "affix", label: "Prefix or suffix" },
] as const;
const VALIDATION_DELAY_MS = 160;

type BatchRenameDialogProps = {
  items: readonly EntryContextTarget[];
  onClose: () => void;
  onApply: (requests: BatchRenameRequest[]) => Promise<void>;
};

type Validation = {
  requests: BatchRenameRequest[];
  errors?: ReadonlyMap<string, string>;
  message?: string;
};

const validateRequests = async (requests: BatchRenameRequest[]) => {
  const errors = await validateBatchRename(requests);
  if (errors.length !== requests.length) throw new Error("Could not check each proposed name.");
  const byPath = new Map<string, string>();
  requests.forEach(({ path }, index) => {
    const error = errors[index];
    if (error) byPath.set(path, error);
  });
  return byPath;
};

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  return fallback;
};

export const BatchRenameDialog = ({ items, onClose, onApply }: BatchRenameDialogProps) => {
  const first = items[0];
  const [mode, setMode] = useState<BatchRenameMode>("number");
  const [rules, setRules] = useState<{ [M in BatchRenameMode]: Extract<BatchRenameRule, { mode: M }> }>(() => ({
    number: { mode: "number", baseName: first?.isDir ? first.name : splitNameExtension(first?.name ?? "").base },
    replace: { mode: "replace", find: "", replacement: "", matchCase: false },
    affix: { mode: "affix", prefix: "", suffix: "" },
  }));
  const [numberingExpanded, setNumberingExpanded] = useState(false);
  const [preserveExtensions, setPreserveExtensions] = useState(true);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const backdropPressed = useRef(false);
  const panelRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();

  useModalFocusTrap({ open: true, containerRef: panelRef, initialFocusRef: inputRef });
  useLayoutEffect(() => inputRef.current?.select(), []);

  const rule = rules[mode];
  const updateRule = (next: BatchRenameRule) => setRules((current) => ({ ...current, [next.mode]: next }));
  const rows = useMemo(() => buildBatchRenamePreview(items, rule, preserveExtensions), [items, rule, preserveExtensions]);
  const requests = useMemo(() => rows.flatMap(({ item, nextName }) =>
    nextName !== item.name ? [{ path: item.path, nextName }] : [],
  ), [rows]);
  const hasLocalErrors = rows.some((row) => Boolean(row.error));
  const current = validation?.requests === requests ? validation : null;
  const checking = requests.length > 0 && !hasLocalErrors && current === null;
  const canApply = !applying && requests.length > 0 && !hasLocalErrors
    && current?.errors?.size === 0 && !current.message;

  useEffect(() => {
    if (requests.length === 0 || hasLocalErrors) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void validateRequests(requests).then(
        (errors) => { if (active) setValidation({ requests, errors }); },
        (error: unknown) => {
          if (active) setValidation({
            requests,
            message: errorMessage(error, "Could not check the names."),
          });
        },
      );
    }, VALIDATION_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hasLocalErrors, requests]);

  const close = () => {
    if (!applyingRef.current) onClose();
  };

  const loadPreset = ({ rule: savedRule, preserveExtensions }: BatchRenamePreset) => {
    setMode(savedRule.mode);
    setPreserveExtensions(preserveExtensions);
    if (savedRule.mode === "number" && savedRule.numbering) setNumberingExpanded(true);
    updateRule(savedRule);
  };

  const apply = async () => {
    if (!canApply || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      // The directory may have changed since the preview was checked.
      const errors = await validateRequests(requests);
      if (errors.size > 0) {
        setValidation({ requests, errors });
        return;
      }
      await onApply(requests);
      onClose();
    } catch (error) {
      setValidation({ requests, message: errorMessage(error, "Could not rename the items.") });
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const numberingInvalid = rule.mode === "number" &&
    !isBatchRenameNumberingValid(rule.numbering ?? DEFAULT_BATCH_RENAME_NUMBERING);
  const status = current?.message
    ?? (applying
      ? "Renaming…"
      : checking
        ? "Checking names…"
        : hasLocalErrors || (current?.errors?.size ?? 0) > 0
          ? "Resolve the flagged names to continue."
          : rule.mode === "number" && !rule.baseName.trim()
            ? "Enter a base name."
            : numberingInvalid
              ? "Enter valid values for start, step and minimum digits."
              : requests.length === 0
                ? "No changes"
                : `${requests.length} of ${items.length} items will be renamed`);

  return (
    <div
      className="batch-rename-modal"
      data-open="true"
      onPointerDown={(event) => {
        backdropPressed.current = event.button === 0 && event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const clickedBackdrop = backdropPressed.current && event.target === event.currentTarget;
        backdropPressed.current = false;
        if (clickedBackdrop) close();
      }}
    >
      <form
        className="batch-rename-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={applying}
        ref={panelRef}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <OverlayPanelHeader
          className="batch-rename-header"
          title="Batch rename"
          titleId={titleId}
          actions={<DialogCloseButton onClose={close} />}
        />
        <fieldset className="batch-rename-options" disabled={applying}>
          <div className="batch-rename-modes" role="group" aria-label="Rename method">
            {MODES.map(({ id, label }) => (
              <PressButton
                type="button"
                key={id}
                aria-pressed={mode === id}
                className={mode === id ? "batch-rename-mode is-active" : "batch-rename-mode"}
                onClick={() => setMode(id)}
              >
                {label}
              </PressButton>
            ))}
          </div>
          <BatchRenameRuleFields rule={rule} disabled={applying} initialInputRef={inputRef}
            numberingExpanded={numberingExpanded} onToggleNumbering={() => setNumberingExpanded((open) => !open)}
            onChange={updateRule} />
          <div className="batch-rename-checks">
            <label>
              <input type="checkbox" checked={preserveExtensions} onChange={(event) => setPreserveExtensions(event.target.checked)} />
              Preserve file extensions
            </label>
            {rule.mode === "replace" ? (
              <label>
                <input type="checkbox" checked={rule.matchCase}
                  onChange={(event) => updateRule({ ...rule, matchCase: event.currentTarget.checked })} />
                Match case
              </label>
            ) : null}
          </div>
          <BatchRenamePresets
            rule={rule}
            preserveExtensions={preserveExtensions}
            disabled={applying}
            onLoad={loadPreset}
          />
        </fieldset>
        <BatchRenamePreview rows={rows} diskErrors={current?.errors} />
        <div className="batch-rename-footer">
          <div className={current?.message || numberingInvalid ? "batch-rename-error tnum" : "batch-rename-status tnum"} role="status">
            {status}
          </div>
          <div className="batch-rename-actions">
            <PressButton className="btn ghost" type="button" onClick={close} disabled={applying}>Cancel</PressButton>
            <button className="btn" type="submit" disabled={!canApply}>Apply</button>
          </div>
        </div>
      </form>
    </div>
  );
};
