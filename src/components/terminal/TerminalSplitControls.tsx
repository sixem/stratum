import { shallow } from "zustand/shallow";
import { ContextUnlinkIcon, LinkIcon, PanelBottomIcon, PanelRightIcon, SwapSidesIcon } from "@/components/icons/contextMenuIcons";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { setDirectoryLinked, swapTerminalSplitSides, toggleTerminalSplitLayout } from "@/modules/terminalSplit";

export function TerminalSplitControls({ pane }: { pane: LinkedPane }) {
  const useStore = getPaneSessionStore(pane);
  const [id, linked, stacked] = useStore(state => {
    const split = state.tabs.find(tab => tab.id === state.activeTabId)?.split;
    return [split ? state.activeTabId : null, Boolean(split?.linkDirectory), Boolean(split?.stacked)] as const;
  }, shallow);
  if (!id) return null;
  return (
    <div className="terminal-split-actions" data-stacked={stacked || undefined}>
      <ToolbarIconButton label={linked ? "Unlink PowerShell directory" : "Link PowerShell directory"}
        active={linked} pressed={linked} pressOnPointerDown={false} onClick={() => setDirectoryLinked(pane, id, !linked)}>
        {linked ? <ContextUnlinkIcon /> : <LinkIcon />}
      </ToolbarIconButton>
      <ToolbarIconButton label="Swap folder and PowerShell" pressOnPointerDown={false}
        onClick={() => swapTerminalSplitSides(pane, id)}>
        <SwapSidesIcon />
      </ToolbarIconButton>
      <ToolbarIconButton label={stacked ? "Split side by side" : "Split top and bottom"} pressOnPointerDown={false}
        onClick={() => toggleTerminalSplitLayout(pane, id)}>
        {stacked ? <PanelRightIcon /> : <PanelBottomIcon />}
      </ToolbarIconButton>
    </div>
  );
}
