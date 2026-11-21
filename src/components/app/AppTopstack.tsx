// Renders the app header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps } from "react";
import { setBottomPaneActive, useBottomPaneStore } from "@/modules/bottomPaneStore";
import { PathBar } from "@/components/explorer/PathBar";
import { PathInputsBar } from "@/components/explorer/PathInputsBar";
import { PathCrumbsBar } from "@/components/explorer/PathCrumbsBar";
import { TabsBar } from "@/components/navigation/TabsBar";
import { WorkspacePicker } from "@/components/navigation/WorkspacePicker";

type AppTopstackProps = {
  pathBar: ComponentProps<typeof PathBar>;
  pathInputsBar: ComponentProps<typeof PathInputsBar>;
  tabsBar: ComponentProps<typeof TabsBar>;
  crumbsBar: ComponentProps<typeof PathCrumbsBar>;
};

export const AppTopstack = ({
  pathBar,
  pathInputsBar,
  tabsBar,
  crumbsBar,
}: AppTopstackProps) => {
  const split = useBottomPaneStore((state) => state.open);
  const focusMain = (event: { target: EventTarget }) => {
    if (event.target instanceof Element && event.target.closest("[data-workspace-picker]")) return;
    setBottomPaneActive(false);
  };
  return (
    <div className="topstack" onPointerDownCapture={focusMain} onFocusCapture={focusMain}>
      <div className="header">
        <PathBar {...pathBar} />
        <div className="path-tabs">
          <PathInputsBar {...pathInputsBar} />
          <TabsBar {...tabsBar} leading={<WorkspacePicker />} />
        </div>
      </div>
      <PathCrumbsBar {...crumbsBar} reserveSpace={split} />
    </div>
  );
};
