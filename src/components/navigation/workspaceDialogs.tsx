// Use the existing prompt shell for workspace names and confirmations.
import { toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import type { PromptConfig } from "@/modules";

export const runWorkspaceAction = (action: () => void) => {
  try {
    action();
  } catch (error) {
    usePromptStore.getState().showPrompt({
      title: "Workspaces",
      content: toMessage(error, "Couldn't update the workspace."),
      confirmLabel: "OK",
    });
  }
};

export const promptWorkspaceName = (
  title: string, confirmLabel: string, initialName: string, submit: (name: string) => void,
) => {
  const show = (value: string, error?: string) => {
    let name = value;
    const onConfirm = () => {
      try {
        submit(name);
      } catch (error) {
        show(name, toMessage(error, "Couldn't save the workspace."));
      }
    };
    const id = "workspace-name";
    const prompt: PromptConfig = {
      title,
      confirmLabel,
      cancelLabel: "Cancel",
      onConfirm,
      content: (
        <div className="prompt-field">
          <label className="prompt-label" htmlFor={id}>Name</label>
          <input
            id={id}
            className="prompt-input"
            type="text"
            autoComplete="off"
            defaultValue={value}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { name = event.currentTarget.value; }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
              event.preventDefault();
              event.stopPropagation();
              const closed = usePromptStore.getState().hidePrompt(prompt);
              if (closed && event.key === "Enter") onConfirm();
            }}
          />
          {error ? <div className="workspace-name-error" id={`${id}-error`} role="alert">{error}</div> : null}
        </div>
      ),
    };
    usePromptStore.getState().showPrompt(prompt);
  };
  show(initialName);
};
