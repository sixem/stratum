// Opens, captures, and manages saved layouts from the main tab strip.
import { useCallback, useId, useRef, useState } from "react";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { ContextMoreOptionsIcon } from "@/components/icons/contextMenuIcons";
import { useOverlayDismiss } from "@/components/overlay/useOverlayDismiss";
import { ToolbarPopover } from "@/components/primitives/ToolbarPopover";
import { folderPathKey } from "@/lib";
import { usePromptStore } from "@/modules";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { usePlacesStore } from "@/modules/placesStore";
import { useBottomSessionStore, useSessionStore } from "@/modules/sessionStore";
import type { SessionState } from "@/modules/sessionStore";
import { createFreshWorkspace, removeWorkspace, saveWorkspace, switchWorkspace, useWorkspaceStore } from "@/modules/workspaceStore";
import type { Workspace, WorkspaceLayout } from "@/modules/workspaceStore";
import { promptWorkspaceName, runWorkspaceAction } from "./workspaceDialogs";

const captureSession = ({ tabs, activeTabId, recentJumps }: SessionState, pane: "main" | "bottom"): SessionState => {
  const files = document.querySelector<HTMLElement>(`[data-file-pane="${pane}"]`);
  const viewport = files?.querySelector<HTMLElement>(".list-body, .thumb-viewport");
  const displayedPath = folderPathKey(files?.dataset.panePath ?? "");
  return {
    activeTabId,
    recentJumps: [...recentJumps],
    tabs: tabs.map((tab) => ({
      ...tab,
      sort: { ...tab.sort },
      scrollTop: viewport && displayedPath && tab.id === activeTabId && displayedPath === folderPathKey(tab.path)
        ? viewport.scrollTop : tab.scrollTop,
    })),
  };
};

const captureLayout = (): WorkspaceLayout => {
  const { open, height, defaultViewMode, active } = useBottomPaneStore.getState();
  const { initialized, places } = usePlacesStore.getState();
  return {
    main: captureSession(useSessionStore.getState(), "main"),
    bottom: captureSession(useBottomSessionStore.getState(), "bottom"),
    pane: { open, height, defaultViewMode, active: open && active },
    places: { initialized, places: places.map((place) => ({ ...place })) },
  };
};

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
  const name = workspaces.find((item) => item.id === activeId)?.name;
  const [open, setOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setActionsFor(null);
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
      switchWorkspace(target, captureLayout());
      focusRestoredPane();
    });
  };

  const create = () => {
    closeAndFocus();
    promptWorkspaceName("New workspace", "Create", "", (name) => {
      createFreshWorkspace(name, captureLayout());
      focusRestoredPane();
    });
  };
  const save = () => {
    closeAndFocus();
    promptWorkspaceName("Save workspace", "Save", "", (name) => saveWorkspace(name, captureLayout()));
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
      onConfirm: () => runWorkspaceAction(() => saveWorkspace(workspace.name, captureLayout(), workspace.id)),
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
        onClick={() => { if (open) close(); else setOpen(true); }}
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
          footer={(
            <>
              {previous ? <button type="button" onClick={() => load(previous)}>Previous session</button> : null}
              <div className="workspace-save-actions">
                <button type="button" onClick={create}><PlusIcon />New workspace…</button>
                <button type="button" onClick={save}>Save current as…</button>
              </div>
            </>
          )}
        >
          {workspaces.length ? (
            <ul className="toolbar-popover-list workspace-list">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <div className="workspace-row">
                    <button type="button" className="workspace-name" onClick={() => load(workspace)}
                      aria-current={workspace.id === activeId ? "true" : undefined}>
                      {workspace.name}
                    </button>
                    <button
                      type="button"
                      className="workspace-more"
                      aria-label={`Actions for ${workspace.name}`}
                      aria-expanded={actionsFor === workspace.id}
                      onClick={() => setActionsFor(actionsFor === workspace.id ? null : workspace.id)}
                    >
                      <ContextMoreOptionsIcon />
                    </button>
                  </div>
                  {actionsFor === workspace.id ? (
                    <div className="workspace-actions">
                      <button type="button" onClick={() => rename(workspace)}>Rename</button>
                      <button type="button" onClick={() => replace(workspace)}>Replace with current</button>
                      <button type="button" onClick={() => duplicate(workspace)}>Duplicate</button>
                      <button type="button" onClick={() => remove(workspace)}>Delete</button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </ToolbarPopover>
      ) : null}
    </div>
  );
};
