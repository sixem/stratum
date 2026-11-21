// Let the user choose which workspace drafts become saved layouts before closing.
import { useState } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { toMessage } from "@/lib";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { usePromptStore } from "@/modules";
import type { PromptConfig } from "@/modules";
import { getWorkspaceChanges, saveWorkspaceChanges } from "@/modules/workspaceStore";
import type { Workspace } from "@/modules/workspaceStore";

type WorkspaceCloseChoicesProps = {
  changes: Workspace[];
  onCancel: () => void;
  onExit: () => void;
};

const WorkspaceCloseChoices = ({ changes, onCancel, onExit }: WorkspaceCloseChoicesProps) => {
  const [selected, setSelected] = useState(() => new Set(changes.map(({ id }) => id)));
  const [error, setError] = useState<string | null>(null);

  const saveAndExit = () => {
    if (!selected.size) return;
    try {
      // A pending folder load may finish while the dialog is open.
      const currentChanges = getWorkspaceChanges(captureWorkspaceLayout());
      saveWorkspaceChanges(currentChanges.filter(({ id }) => selected.has(id)));
    } catch (error) {
      setError(toMessage(error, "Couldn't save the selected workspaces."));
      return;
    }
    onExit();
  };

  return (
    <div className="workspace-close-choices">
      <div>Choose which workspaces to save before exiting. Unchecked changes stay as drafts.</div>
      <ul className="workspace-close-list">
        {changes.map(({ id, name }) => (
          <li key={id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
              />
              {name}
            </label>
          </li>
        ))}
      </ul>
      {error ? <div className="workspace-name-error" role="alert">{error}</div> : null}
      <div className="prompt-actions">
        <PressButton type="button" className="btn ghost" onClick={onCancel}>Cancel</PressButton>
        <PressButton type="button" className="btn ghost" onClick={onExit}>Exit without saving</PressButton>
        <PressButton type="button" className="btn" disabled={!selected.size} onClick={saveAndExit}>
          Save selected and exit
        </PressButton>
      </div>
    </div>
  );
};

export const showWorkspaceClosePrompt = (changes: Workspace[], exit: () => void) => {
  const { showPrompt, hidePrompt } = usePromptStore.getState();
  const prompt: PromptConfig = {
    title: "Unsaved workspaces",
    confirmLabel: null,
    aboveOverlays: true,
    content: (
      <WorkspaceCloseChoices
        changes={changes}
        onCancel={() => hidePrompt(prompt)}
        onExit={() => { if (hidePrompt(prompt)) exit(); }}
      />
    ),
  };
  showPrompt(prompt);
};
