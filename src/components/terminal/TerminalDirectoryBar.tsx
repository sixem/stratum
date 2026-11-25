import { SquareTerminalIcon } from "@/components/icons/SquareTerminalIcon";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

// The shell reports this path. Folder navigation stays in the file view.
export function TerminalDirectoryBar({ directory }: { directory: string }) {
  return <div className="crumbbar terminal-directory-bar" role="group" aria-label="Terminal working directory">
    <SquareTerminalIcon />
    <TooltipWrapper text={directory}>
      <span className="terminal-directory-path">{directory || "PowerShell"}</span>
    </TooltipWrapper>
  </div>;
}
