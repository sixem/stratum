// Shared prompt helper for creating files or folders.
import { useCallback } from "react";
import { usePromptStore } from "@/modules";

type CreateEntryKind = "folder" | "file";

type CreateEntryPromptOptions = {
  kind: CreateEntryKind;
  parentPath: string;
  onCreate: (parentPath: string, name: string) => Promise<unknown> | void;
  // Optional "create and open" helper (used for folders).
  onCreateAndGo?: (parentPath: string, name: string) => Promise<unknown> | void;
  preserveWhitespace?: boolean;
};

export const useCreateEntryPrompt = () => {
  return useCallback(
    ({ kind, parentPath, onCreate, onCreateAndGo, preserveWhitespace = false }: CreateEntryPromptOptions) => {
      const target = preserveWhitespace ? parentPath : parentPath.trim();
      if (!target) return;
      const defaultName = kind === "folder" ? "New folder" : "New file.txt";
      const nameRef = { current: defaultName };
      const runCreate = () => {
        const name = preserveWhitespace ? nameRef.current : nameRef.current.trim();
        if (!name) return;
        void onCreate(target, name);
      };
      const runCreateAndGo = () => {
        if (!onCreateAndGo) return;
        const name = preserveWhitespace ? nameRef.current : nameRef.current.trim();
        if (!name) return;
        void onCreateAndGo(target, name);
      };
      const extraActions = onCreateAndGo
        ? [
            {
              label: "Create & open",
              onClick: runCreateAndGo,
            },
          ]
        : undefined;

      usePromptStore.getState().showPrompt({
        title: kind === "folder" ? "New folder" : "New file",
        content: (
          <div className="prompt-field">
            <span className="prompt-label">Name</span>
            <input
              className="prompt-input"
              type="text"
              aria-label="Name"
              defaultValue={defaultName}
              autoFocus
              onFocus={(event) => {
                const input = event.currentTarget;
                input.setSelectionRange(0, input.value.length);
              }}
              onChange={(event) => {
                nameRef.current = event.currentTarget.value;
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                // Keep Enter as regular create; Ctrl+Enter uses the optional create-and-open flow.
                if (event.ctrlKey && onCreateAndGo) {
                  runCreateAndGo();
                } else {
                  runCreate();
                }
                usePromptStore.getState().hidePrompt();
              }}
            />
          </div>
        ),
        confirmLabel: "Create",
        cancelLabel: "Cancel",
        actions: extraActions,
        onConfirm: runCreate,
      });
    },
    [],
  );
};
