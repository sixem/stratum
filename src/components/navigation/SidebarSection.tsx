// Collapsible sidebar section wrapper.
import type { ReactNode } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { SidebarCollapseIcon, SidebarExpandIcon } from "@/components/icons";

type SidebarSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export const SidebarSection = ({ title, isOpen, onToggle, children }: SidebarSectionProps) => {
  const ToggleIcon = isOpen ? SidebarCollapseIcon : SidebarExpandIcon;
  return (
    <>
      <PressButton
        type="button"
        className={`section-toggle${isOpen ? " is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <span>{title}</span>
        <span className="toggle-mark" aria-hidden="true">
          <ToggleIcon className="toggle-mark-icon" />
        </span>
      </PressButton>
      {isOpen ? <div className="places">{children}</div> : null}
    </>
  );
};
