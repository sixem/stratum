// Composes the topstack and main content for the app shell.
import type { ComponentProps } from "react";
import { AppContentContainer } from "./AppContentContainer";
import { AppTopstackContainer } from "./AppTopstackContainer";

type AppLayoutProps = {
  topstack: ComponentProps<typeof AppTopstackContainer>;
  content: ComponentProps<typeof AppContentContainer>;
};

export const AppLayout = ({ topstack, content }: AppLayoutProps) => {
  return (
    <>
      <AppTopstackContainer {...topstack} />
      <AppContentContainer {...content} />
    </>
  );
};
