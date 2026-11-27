// Composes the topstack and main content for the app shell.
import type { ComponentProps } from "react";
import { AppContentContainer } from "./AppContentContainer";
import { AppTopstackContainer } from "./AppTopstackContainer";
import { useSettingsStore } from "@/modules";

type AppLayoutProps = {
  topstack: ComponentProps<typeof AppTopstackContainer>;
  content: ComponentProps<typeof AppContentContainer>;
};

export const AppLayout = ({ topstack, content }: AppLayoutProps) => {
  const fullWidthBreadcrumbs = useSettingsStore((state) => state.fullWidthBreadcrumbs);
  return (
    <AppTopstackContainer {...topstack} crumbsInContent={!fullWidthBreadcrumbs}
      renderContent={(crumbs) => <AppContentContainer {...content} mainCrumbs={crumbs}
        crumbsInContent={!fullWidthBreadcrumbs} />} />
  );
};
