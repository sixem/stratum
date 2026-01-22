// Renders the fixed header stack (drive bar, path bar, tabs, crumbs).
import type { ComponentProps, RefObject } from "react";
import { DriveBar } from "@/components/DriveBar";
import { PathBar } from "@/components/PathBar";
import { PathCrumbsBar } from "@/components/PathCrumbsBar";
import { TabsBar } from "@/components/TabsBar";

type AppTopstackProps = {
  topstackRef: RefObject<HTMLDivElement | null>;
  driveBar: ComponentProps<typeof DriveBar>;
  pathBar: ComponentProps<typeof PathBar>;
  tabsBar: ComponentProps<typeof TabsBar>;
  crumbsBar: ComponentProps<typeof PathCrumbsBar>;
};

export const AppTopstack = ({
  topstackRef,
  driveBar,
  pathBar,
  tabsBar,
  crumbsBar,
}: AppTopstackProps) => {
  return (
    <div className="topstack" ref={topstackRef}>
      <div className="header">
        <DriveBar {...driveBar} />
        <PathBar {...pathBar} />
      </div>
      <TabsBar {...tabsBar} />
      <PathCrumbsBar {...crumbsBar} />
    </div>
  );
};
