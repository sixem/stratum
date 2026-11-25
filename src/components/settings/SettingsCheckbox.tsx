// Keep native checkbox behavior with the same accent and focus colors as Settings.
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { CheckmarkIcon } from "@/components/icons";

type Props = Omit<ComponentPropsWithoutRef<"input">, "children" | "className" | "type"> & {
  children: ReactNode;
};

export const SettingsCheckbox = ({ children, ...input }: Props) => (
  <label className="settings-checkbox">
    <span className="settings-checkbox-control">
      <input {...input} type="checkbox" />
      <CheckmarkIcon />
    </span>
    <span>{children}</span>
  </label>
);
