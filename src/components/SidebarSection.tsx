// Collapsible sidebar section wrapper.
import type { ReactNode } from "react";

type SidebarSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export const SidebarSection = ({ title, isOpen, onToggle, children }: SidebarSectionProps) => {
  return (
    <>
      <button
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
      </button>
      {isOpen ? <div className="places">{children}</div> : null}
    </>
  );
};
