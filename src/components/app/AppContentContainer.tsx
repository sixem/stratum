// Thin container for the primary content layout to keep App.tsx readable.
import type { ComponentProps } from "react";
import { AppContent } from "./AppContent";

export type AppContentContainerProps = ComponentProps<typeof AppContent>;

export const AppContentContainer = (props: AppContentContainerProps) => {
  return <AppContent {...props} />;
};
