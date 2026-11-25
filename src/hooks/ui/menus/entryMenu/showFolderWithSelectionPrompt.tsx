// Keep the name field open when folder creation fails so the user can edit it.
import { createRef, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import type { PromptConfig } from "@/modules";

export type CreateFolderWithSelection = (
  paths: string[], parent: string, name: string, onCreated: () => void,
) => Promise<unknown>;

const FolderNameForm = ({
  formRef, onSubmitName,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  onSubmitName: (name: string) => Promise<unknown>;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const name = input.current?.value.trim();
    if (!name) {
      setError("Enter a folder name.");
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onSubmitName(name);
    } catch (error) {
      setError(toMessage(error, "Couldn't create the folder."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} className="prompt-field" aria-busy={busy} onSubmit={submit}>
      <span className="prompt-label">Name</span>
      <input
        ref={input}
        className="prompt-input"
        aria-label="Name"
        aria-invalid={Boolean(error)}
        defaultValue="New folder"
        readOnly={busy}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={() => setError("")}
      />
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
};

export const showFolderWithSelectionPrompt = (
  paths: string[], parent: string, create: CreateFolderWithSelection,
) => {
  const form = createRef<HTMLFormElement>();
  const prompts = usePromptStore.getState();
  const prompt: PromptConfig = {
    title: "New folder with selection",
    content: <FolderNameForm formRef={form} onSubmitName={(name) =>
      create(paths, parent, name, () => prompts.hidePrompt(prompt))} />,
    confirmLabel: null,
    cancelLabel: "Cancel",
    actions: [{ label: "Create & move", variant: "primary", closeOnClick: false, onClick: () => form.current?.requestSubmit() }],
  };
  prompts.showPrompt(prompt);
};
