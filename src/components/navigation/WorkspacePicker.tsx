// Opens, captures, and manages saved layouts from the main tab strip.
import { useCallback, useId, useRef, useState } from "react";
import { CheckmarkIcon, ChevronDownIcon, PlusIcon, SaveIcon } from "@/components/icons";
import { useOverlayDismiss } from "@/components/overlay/useOverlayDismiss";
import { ToolbarPopover } from "@/components/primitives/ToolbarPopover";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { usePromptStore } from "@/modules";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useSessionStore } from "@/modules/sessionStore";
import { createFreshWorkspace, getWorkspaceChanges, removeWorkspace, saveWorkspace, switchWorkspace, useWorkspaceStore } from "@/modules/workspaceStore";
import type { Workspace, WorkspaceLayout } from "@/modules/workspaceStore";
import { promptWorkspaceName, runWorkspaceAction } from "./workspaceDialogs";
import { WorkspaceList } from "./WorkspaceList";

const focusRestoredPane = () => {
  const revision = useSessionStore.getState().restoreRevision;
  window.requestAnimationFrame(() => {
    if (useSessionStore.getState().restoreRevision !== revision || usePromptStore.getState().prompt) return;
    const layout = useBottomPaneStore.getState();
    const pane = layout.open && layout.active ? "bottom" : "main";
    document.querySelector<HTMLElement>(`[data-file-pane="${pane}"]`)?.focus({ preventScroll: true });
  });
};

export const WorkspacePicker = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const previous = useWorkspaceStore((state) => state.previous);
  const activeWorkspace = workspaces.find((item) => item.id === activeId);
  const name = activeWorkspace?.name;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [changedIds, setChangedIds] = useState<ReadonlySet<string>>(() => new Set());
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSaved(false);
  }, []);
  const closeAndFocus = () => {
    close();
    trigger.current?.focus({ preventScroll: true });
  };
  useOverlayDismiss({
    enabled: open,
    refs: [root],
    onPointerDownOutside: close,
    keydownCapture: true,
    onEscape: (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    },
  });

  const load = (target: { id: string | null; layout: WorkspaceLayout }) => {
    closeAndFocus();
    runWorkspaceAction(() => {
      switchWorkspace(target, captureWorkspaceLayout());
      focusRestoredPane();
    });
  };

  const loadNamed = (workspace: Workspace) => {
    if (workspace.id === activeId) {
      closeAndFocus();
      return;
    }
    const draft = useWorkspaceStore.getState().drafts.find(({ id }) => id === workspace.id);
    load(draft ?? workspace);
  };

  const create = () => {
    closeAndFocus();
    promptWorkspaceName("New workspace", "Create", "", (name) => {
      createFreshWorkspace(name, captureWorkspaceLayout());
      focusRestoredPane();
    });
  };
  const saveAs = () => {
    closeAndFocus();
    promptWorkspaceName("Save workspace as", "Save", "", (name) => saveWorkspace(name, captureWorkspaceLayout()));
  };
  const saveCurrent = () => {
    if (!activeWorkspace) return;
    runWorkspaceAction(() => {
      saveWorkspace(activeWorkspace.name, captureWorkspaceLayout(), activeWorkspace.id);
      setChangedIds((ids) => {
        const next = new Set(ids);
        next.delete(activeWorkspace.id);
        return next;
      });
      setSaved(true);
    });
  };

  const rename = (workspace: Workspace) => {
    closeAndFocus();
    promptWorkspaceName("Rename workspace", "Rename", workspace.name, (name) => {
      saveWorkspace(name, workspace.layout, workspace.id, false);
    });
  };
  const duplicate = (workspace: Workspace) => {
    closeAndFocus();
    promptWorkspaceName("Duplicate workspace", "Save", `${workspace.name} copy`, (name) => {
      saveWorkspace(name, workspace.layout, undefined, false);
    });
  };
  const replace = (workspace: Workspace) => {
    closeAndFocus();
    usePromptStore.getState().showPrompt({
      title: "Replace workspace?",
      content: `Replace the saved tabs, panes, and places for “${workspace.name}” with the current ones?`,
      confirmLabel: "Replace",
      cancelLabel: "Cancel",
      onConfirm: () => runWorkspaceAction(() => saveWorkspace(workspace.name, captureWorkspaceLayout(), workspace.id)),
    });
  };
  const remove = (workspace: Workspace) => {
    closeAndFocus();
    usePromptStore.getState().showPrompt({
      title: "Delete workspace?",
      content: `Delete the saved workspace “${workspace.name}”?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => runWorkspaceAction(() => removeWorkspace(workspace.id)),
    });
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setChangedIds(new Set(getWorkspaceChanges(captureWorkspaceLayout()).map(({ id }) => id)));
    setOpen(true);
  };

  return (
    <div
      ref={root}
      className="workspace-picker"
      data-workspace-picker="true"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (open) event.stopPropagation();
      }}
    >
      <button
        ref={trigger}
        className="workspace-trigger"
        type="button"
        aria-label={name ? `Workspaces, ${name}` : "Workspaces"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <span>{name ?? "Workspaces"}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <ToolbarPopover
          className="workspace-popover"
          id={id}
          role="region"
          aria-label="Workspaces"
          heading="Workspaces"
          headerAction={(
            <button type="button" className="workspace-command" onClick={create}><PlusIcon />New workspace</button>
          )}
          footer={(
            <>
              {previous ? (
                <button type="button" className="workspace-command" onClick={() => load(previous)}>Previous session</button>
              ) : null}
              <div className="workspace-save-actions">
                {activeWorkspace ? (
                  <button type="button" className="workspace-command workspace-save" onClick={saveCurrent}>
                    {saved ? <CheckmarkIcon /> : <SaveIcon />}
                    <span aria-live="polite">{saved ? "Saved" : "Save"}</span>
                  </button>
                ) : null}
                <button type="button" className="workspace-command" onClick={saveAs}>
                  {activeWorkspace ? "Save as…" : <><SaveIcon />Save workspace…</>}
                </button>
              </div>
            </>
          )}
        >
          <WorkspaceList
            workspaces={workspaces}
            activeId={activeId}
            changedIds={changedIds}
            onLoad={loadNamed}
            onRename={rename}
            onDuplicate={duplicate}
            onReplace={replace}
            onRemove={remove}
          />
        </ToolbarPopover>
      ) : null}
    </div>
  );
};
