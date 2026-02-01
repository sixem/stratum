// App shell layout: wires the topstack, content, and status bar.
import type { ComponentProps } from "react";
import type { AppContentContainerProps } from "./AppContentContainer";
import type { AppTopstackContainerProps } from "./AppTopstackContainer";
import { AppLayout } from "./AppLayout";
import { AppStatusbar } from "./AppStatusbar";

type AppShellLayoutProps = {
  topstack: AppTopstackContainerProps;
  content: AppContentContainerProps;
  statusbar: ComponentProps<typeof AppStatusbar>;
};

export const AppShellLayout = ({
  topstack,
  content,
  statusbar,
}: AppShellLayoutProps) => {
  return (
    <>
      <AppLayout topstack={topstack} content={content} />
      <AppStatusbar {...statusbar} />
    </>
  );
};
