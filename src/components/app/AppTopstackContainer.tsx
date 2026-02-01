// Thin container for the topstack layout so App.tsx stays focused on wiring.
import type { ComponentProps } from "react";
import { AppTopstack } from "./AppTopstack";

export type AppTopstackContainerProps = ComponentProps<typeof AppTopstack>;

export const AppTopstackContainer = (props: AppTopstackContainerProps) => {
  return <AppTopstack {...props} />;
};
