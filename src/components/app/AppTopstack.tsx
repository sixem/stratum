// Renders the fixed header stack (controls, inputs, tabs, crumbs).
import type { ComponentProps, RefObject } from "react";
import { PathBar } from "@/components/PathBar";
import { PathInputsBar } from "@/components/PathInputsBar";
import { PathCrumbsBar } from "@/components/PathCrumbsBar";
import { TabsBar } from "@/components/TabsBar";

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
