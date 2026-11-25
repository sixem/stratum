// Link the current two tabs and show when the pair is paused or unavailable.
import { RefreshIcon } from "@/components/icons";
import { FolderSymlinkIcon } from "@/components/icons/contextMenuIcons";
import { ToolbarIconButton } from "@/components/primitives/ToolbarIconButton";
import { coercePaneLink, relativeLinkedPath } from "@/lib/paneLink";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { usePaneLinkIssue } from "@/modules/paneLinkNavigation";
import { useSessionStore } from "@/modules/sessionStore";

type Props = { mainPath: string; bottomPath: string; bottomTabId: string | null };

export function PaneLinkControls({ mainPath, bottomPath, bottomTabId }: Props) {
  const mainTabId = useSessionStore((state) => state.activeTabId);
  const link = useBottomPaneStore((state) => state.link);
  const unavailablePath = usePaneLinkIssue((state) => state.unavailablePath);
  const canLink = Boolean(mainTabId && bottomTabId && mainPath && bottomPath);
  const differentTabs = link && (mainTabId !== link.mainTabId || bottomTabId !== link.bottomTabId);
  const outsideRoots = link && mainPath && bottomPath &&
    (relativeLinkedPath(link.mainRootPath, mainPath) === null || relativeLinkedPath(link.bottomRootPath, bottomPath) === null);
  const reason = differentTabs ? "Link paused. Return to the paired tabs to resume."
    : outsideRoots ? "Link paused. Return to the paired folders to resume."
    : unavailablePath ? `Linked folder unavailable\n${unavailablePath}`
    : null;

  const relink = () => {
    const next = coercePaneLink({ mainTabId, mainRootPath: mainPath, bottomTabId, bottomRootPath: bottomPath });
    if (next) useBottomPaneStore.setState({ link: next });
  };

  return <>
    <ToolbarIconButton
      label={reason ?? (link ? "Unlink pane navigation" : "Link pane navigation")}
      ariaLabel={reason ? `Link pane navigation. ${reason}` : "Link pane navigation"}
      active={Boolean(link) && !reason}
      pressed={Boolean(link)}
      disabled={!link && !canLink}
      onClick={link ? () => useBottomPaneStore.setState({ link: null }) : relink}
      pressOnPointerDown={false}
    >
      <FolderSymlinkIcon />
    </ToolbarIconButton>
    {link && <ToolbarIconButton label="Relink here" disabled={!canLink} onClick={relink} pressOnPointerDown={false}>
      <RefreshIcon />
    </ToolbarIconButton>}
  </>;
}
