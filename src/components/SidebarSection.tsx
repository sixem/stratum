// Collapsible sidebar section wrapper.
import type { ReactNode } from "react";
import { PressButton } from "./PressButton";

type SidebarSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export const SidebarSection = ({ title, isOpen, onToggle, children }: SidebarSectionProps) => {
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
        <span className="toggle-mark">{isOpen ? "-" : "+"}</span>
      </PressButton>
      {isOpen ? <div className="places">{children}</div> : null}
    </>
  );
};
