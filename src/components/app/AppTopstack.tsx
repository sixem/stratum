// Renders the fixed header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps, RefObject } from "react";
import { PathBar } from "@/components/explorer/PathBar";
import { PathInputsBar } from "@/components/explorer/PathInputsBar";
import { PathCrumbsBar } from "@/components/explorer/PathCrumbsBar";
import { TabsBar } from "@/components/navigation/TabsBar";

type AppTopstackProps = {
  topstackRef: RefObject<HTMLDivElement | null>;
  pathBar: ComponentProps<typeof PathBar>;
  pathInputsBar: ComponentProps<typeof PathInputsBar>;
  tabsBar: ComponentProps<typeof TabsBar>;
  crumbsBar: ComponentProps<typeof PathCrumbsBar>;
};

export const AppTopstack = ({
  topstackRef,
  pathBar,
  pathInputsBar,
  tabsBar,
  crumbsBar,
}: AppTopstackProps) => {
  return (
    <div className="topstack" ref={topstackRef}>
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
