// Workspace switches and management actions share a compact row.
import type { ReactNode } from "react";
import { CheckmarkIcon, CopyActionIcon, RecycleBinIcon, SaveIcon } from "@/components/icons";
import { ContextRenameIcon } from "@/components/icons/contextMenuIcons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import type { Workspace } from "@/modules/workspaceStore";

type ActionProps = {
  label: string;
  workspaceName: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
};

function WorkspaceAction({ label, workspaceName, onClick, destructive, children }: ActionProps) {
  return (
    <TooltipWrapper text={label}>
      <button type="button" className="workspace-action" aria-label={`${label}, ${workspaceName}`}
        data-destructive={destructive || undefined} onClick={onClick}>
        {children}
      </button>
    </TooltipWrapper>
  );
}

type WorkspaceListProps = {
  workspaces: Workspace[];
  activeId: string | null;
  changedIds: ReadonlySet<string>;
  onLoad: (workspace: Workspace) => void;
  onRename: (workspace: Workspace) => void;
  onDuplicate: (workspace: Workspace) => void;
  onReplace: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
};

export function WorkspaceList({
  workspaces, activeId, changedIds, onLoad, onRename, onDuplicate, onReplace, onRemove,
}: WorkspaceListProps) {
  if (!workspaces.length) return null;

  return (
    <ul className="toolbar-popover-list workspace-list">
      {workspaces.map((workspace) => {
        const active = workspace.id === activeId;
        const changed = changedIds.has(workspace.id);
        return (
          <li className="workspace-row" key={workspace.id}>
            <TooltipWrapper text={changed ? `${workspace.name}\nUnsaved changes` : workspace.name}>
              <button type="button" className="workspace-name" onClick={() => onLoad(workspace)}
                aria-current={active ? "true" : undefined}
                aria-label={changed ? `${workspace.name}, unsaved changes` : undefined}>
                <span className="workspace-current-mark">{active ? <CheckmarkIcon /> : null}</span>
                <span className="workspace-name-caption">
                  <span className="workspace-name-text">{workspace.name}</span>
                  {changed ? <span className="workspace-dirty-mark" aria-hidden="true">*</span> : null}
                </span>
              </button>
            </TooltipWrapper>
            <div className="workspace-actions">
              {!active ? (
                <WorkspaceAction label="Replace with current layout" workspaceName={workspace.name} onClick={() => onReplace(workspace)}>
                  <SaveIcon />
                </WorkspaceAction>
              ) : null}
              <WorkspaceAction label="Rename workspace" workspaceName={workspace.name} onClick={() => onRename(workspace)}>
                <ContextRenameIcon />
              </WorkspaceAction>
              <WorkspaceAction label="Duplicate workspace" workspaceName={workspace.name} onClick={() => onDuplicate(workspace)}>
                <CopyActionIcon />
              </WorkspaceAction>
              <WorkspaceAction label="Delete workspace" workspaceName={workspace.name} onClick={() => onRemove(workspace)} destructive>
                <RecycleBinIcon />
              </WorkspaceAction>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
