// Renders the app header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps } from "react";
import { setBottomPaneActive } from "@/modules/bottomPaneStore";
import { PathBar } from "@/components/explorer/PathBar";
import { PathInputsBar } from "@/components/explorer/PathInputsBar";
import { PathCrumbsBar } from "@/components/explorer/PathCrumbsBar";
import { TabsBar } from "@/components/navigation/TabsBar";

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
  return (
    <div className="topstack" onPointerDownCapture={() => setBottomPaneActive(false)} onFocusCapture={() => setBottomPaneActive(false)}>
      <div className="header">
        <PathBar {...pathBar} />
        <div className="path-tabs">
          <PathInputsBar {...pathInputsBar} />
          <TabsBar {...tabsBar} />
        </div>
      </div>
      <PathCrumbsBar {...crumbsBar} />
    </div>
  );
};
