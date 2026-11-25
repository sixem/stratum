import { ContextUnlinkIcon, Link2Icon } from "@/components/icons/contextMenuIcons";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { setDirectoryLinked } from "@/modules/terminalSplit";

export function DirectoryLinkButton({ pane }: { pane: LinkedPane }) {
  const useStore = getPaneSessionStore(pane);
  const id = useStore(state => state.activeTabId);
  const linked = useStore(state => {
    const split = state.tabs.find(tab => tab.id === state.activeTabId)?.split;
    return split ? Boolean(split.linkDirectory) : null;
  });
  if (!id || linked === null) return null;
  return <ToolbarIconButton label={linked ? "Unlink PowerShell directory" : "Link PowerShell directory"}
    active={linked} pressed={linked} pressOnPointerDown={false} onClick={() => setDirectoryLinked(pane, id, !linked)}>
    {linked ? <ContextUnlinkIcon /> : <Link2Icon />}
  </ToolbarIconButton>;
}
