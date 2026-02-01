// Builds the topstack props so App.tsx stays focused on data flow.
import type { ComponentProps, RefObject } from "react";
import { DrivePicker, PathBarActions, SidebarIcon, ToolbarIconButton } from "@/components";
import type { AppTopstackContainerProps } from "@/components/app/AppTopstackContainer";
import { PathBar } from "@/components/PathBar";
import { PathCrumbsBar } from "@/components/PathCrumbsBar";
import { PathInputsBar } from "@/components/PathInputsBar";
import { TabsBar } from "@/components/TabsBar";

type UseAppTopstackPropsOptions = {
  appName: string;
  topstackRef: RefObject<HTMLDivElement | null>;
  pathBar: Omit<ComponentProps<typeof PathBar>, "leftSlot" | "driveSlot" | "rightSlot">;
  pathInputsBar: ComponentProps<typeof PathInputsBar>;
  tabsBar: ComponentProps<typeof TabsBar>;
  crumbsBar: ComponentProps<typeof PathCrumbsBar>;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenAbout: () => void;
  drivePicker: ComponentProps<typeof DrivePicker>;
  pathBarActions: ComponentProps<typeof PathBarActions>;
};

export const useAppTopstackProps = ({
  appName,
  topstackRef,
  pathBar,
  pathInputsBar,
  tabsBar,
  crumbsBar,
  sidebarOpen,
  onToggleSidebar,
  onOpenAbout,
  drivePicker,
  pathBarActions,
}: UseAppTopstackPropsOptions): AppTopstackContainerProps => {
  const leftSlot = (
    <>
      <button
        type="button"
        className="pathbar-brand about-trigger"
        aria-label={`About ${appName}`}
        aria-haspopup="dialog"
        onClick={onOpenAbout}
      >
        <div className="brand-mark">
          <img src="/favicon.png" alt="" aria-hidden="true" />
        </div>
      </button>
      <ToolbarIconButton
        label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        active={sidebarOpen}
        pressed={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </ToolbarIconButton>
    </>
  );

  return {
    topstackRef,
    pathBar: {
      ...pathBar,
      leftSlot,
      driveSlot: <DrivePicker {...drivePicker} />,
      rightSlot: <PathBarActions {...pathBarActions} />,
    },
    pathInputsBar,
    tabsBar,
    crumbsBar,
  };
};
