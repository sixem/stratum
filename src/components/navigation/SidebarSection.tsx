// Collapsible sidebar section wrapper.
import type { ReactNode } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { SidebarExpandIcon } from "@/components/icons";

type SidebarSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export const SidebarSection = ({ title, isOpen, onToggle, children }: SidebarSectionProps) => {
  const ToggleIcon = SidebarExpandIcon;
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
        <span className="section-toggle-label">{title}</span>
        <span className="toggle-mark" aria-hidden="true">
          <ToggleIcon className="toggle-mark-icon" />
        </span>
      </PressButton>
      {isOpen ? <div className="places">{children}</div> : null}
    </>
  );
};
