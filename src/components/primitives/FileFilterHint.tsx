// Reuse the filter examples in both file panes and Indexed Search.
import type { ReactNode } from "react";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

const FILTER_EXAMPLES = "Try >1GB, type:video, or ext:zip.\nCombine filters with a name, like >1GB type:video concert.";

export const FileFilterHint = ({ id, children }: { id: string; children: ReactNode }) => (
  <TooltipWrapper text={FILTER_EXAMPLES}>
    <span className="file-filter-hint">
      {children}
      <span id={id} hidden>{FILTER_EXAMPLES}</span>
    </span>
  </TooltipWrapper>
);
