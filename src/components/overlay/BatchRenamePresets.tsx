import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DropdownSelect, PressButton } from "@/components/primitives";
import { isBatchRenameRuleConfigured, type BatchRenameRule } from "@/lib/batchRename";
import { useBatchRenamePresetStore, type BatchRenamePreset } from "@/modules/batchRenamePresetStore";
import { usePromptStore } from "@/modules/promptStore";

type BatchRenamePresetsProps = {
  rule: BatchRenameRule;
  preserveExtensions: boolean;
  disabled: boolean;
  onLoad: (preset: BatchRenamePreset) => void;
};

export const BatchRenamePresets = ({ rule, preserveExtensions, disabled, onLoad }: BatchRenamePresetsProps) => {
  const presets = useBatchRenamePresetStore((state) => state.presets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editing = name !== null;
  const canSave = isBatchRenameRuleConfigured(rule);
  const selected = presets.find((preset) => preset.id === selectedId);
  const groups = useMemo(() => [{
    id: "rename-presets",
    options: presets.map(({ id, name }) => ({ value: id, label: name })),
  }], [presets]);

  useLayoutEffect(() => {
    if (!editing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [editing]);

  const focusSaveButton = () => {
    const button = saveButtonRef.current;
    (button?.disabled ? button.form : button)?.focus({ preventScroll: true });
  };

  const closeEditor = () => {
    setName(null);
    setError(null);
    focusSaveButton();
  };

  const savePreset = () => {
    if (name === null || !canSave || disabled) return;
    const existingId = selected && selected.name.toLowerCase() === name.trim().toLowerCase()
      ? selected.id
      : undefined;
    const result = useBatchRenamePresetStore.getState().save({ name, rule, preserveExtensions }, existingId);
    if ("error" in result) {
      setError(result.error);
      nameInputRef.current?.focus();
      return;
    }
    setSelectedId(result.preset.id);
    closeEditor();
  };

  const deletePreset = (preset: BatchRenamePreset) => {
    usePromptStore.getState().showPrompt({
      title: "Delete rename preset?",
      content: <>Delete “{preset.name}”?</>,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        const result = useBatchRenamePresetStore.getState().remove(preset.id);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setSelectedId(null);
        setError(null);
        window.requestAnimationFrame(() => {
          if (document.activeElement === document.body) focusSaveButton();
        });
      },
    });
  };

  return (
    <div className="batch-rename-presets">
      <div className="batch-rename-preset-row">
        <DropdownSelect
          className="batch-rename-preset-picker"
          ariaLabel="Rename preset"
          groups={groups}
          value={selected?.id ?? null}
          placeholder={presets.length ? "Choose a preset" : "No saved presets"}
          disabled={disabled || editing || presets.length === 0}
          onChange={(id) => {
            setSelectedId(id);
            setError(null);
            const preset = presets.find((entry) => entry.id === id);
            if (preset) onLoad(preset);
          }}
        />
        <PressButton
          ref={saveButtonRef}
          className="btn ghost"
          type="button"
          aria-expanded={editing}
          disabled={!canSave}
          pressOnPointerDown={false}
          onClick={() => {
            if (editing) {
              closeEditor();
              return;
            }
            setError(null);
            setName(selected?.name ?? "");
          }}
        >
          Save preset
        </PressButton>
        {selected && !editing ? (
          <PressButton className="btn ghost" type="button" pressOnPointerDown={false} onClick={() => deletePreset(selected)}>
            Delete preset
          </PressButton>
        ) : null}
      </div>
      {editing ? (
        <div className="batch-rename-preset-row batch-rename-preset-editor" onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeEditor();
        }}>
          <label className="batch-rename-field">
            Preset name
            <input
              ref={nameInputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.key !== "Enter") return;
                event.preventDefault();
                savePreset();
              }}
            />
          </label>
          <PressButton className="btn ghost" type="button" pressOnPointerDown={false} onClick={closeEditor} aria-label="Cancel saving preset">
            Cancel
          </PressButton>
          <PressButton className="btn" type="button" pressOnPointerDown={false} onClick={savePreset} disabled={!name.trim() || !canSave}>
            Save
          </PressButton>
        </div>
      ) : null}
      {error ? <div className="batch-rename-error" role="alert">{error}</div> : null}
    </div>
  );
};
