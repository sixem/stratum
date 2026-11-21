// Provide a name editor for item surfaces without inline renaming.
import { usePromptStore, type PromptConfig } from "@/modules";
import type { EntryContextTarget } from "@/types";

export const showEntryRenamePrompt = (
  target: EntryContextTarget,
  renameEntry: (path: string, name: string) => Promise<unknown>,
) => {
  let name = target.name;
  const rename = () => {
    const next = name.trim();
    if (next && next !== target.name) void renameEntry(target.path, next);
  };
  const prompt: PromptConfig = {
    title: "Rename item",
    content: (
      <div className="prompt-field">
        <span className="prompt-label">Name</span>
        <input
          className="prompt-input"
          type="text"
          aria-label="Name"
          defaultValue={target.name}
          onChange={(event) => { name = event.currentTarget.value; }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
            event.preventDefault();
            event.stopPropagation();
            const closed = usePromptStore.getState().hidePrompt(prompt);
            if (closed && event.key === "Enter") rename();
          }}
        />
      </div>
    ),
    confirmLabel: "Rename",
    cancelLabel: "Cancel",
    onConfirm: rename,
  };
  usePromptStore.getState().showPrompt(prompt);
};
