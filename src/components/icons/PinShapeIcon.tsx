// Shared pin indicator glyphs for the sidebar, settings, and menu previews.
import type { PinShape } from "@/modules";

export const PinShapeIcon = ({ shape, className }: { shape: PinShape; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    {shape === "circle" && <circle cx="12" cy="12" r="6" fill="currentColor" />}
    {shape === "square" && <rect x="6" y="6" width="12" height="12" fill="currentColor" />}
    {shape === "diamond" && <path d="M12 4 20 12 12 20 4 12Z" fill="currentColor" />}
    {shape === "pill" && <rect x="4" y="8" width="16" height="8" rx="4" fill="currentColor" />}
    {shape === "asterisk" && (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14" />
        <path d="m18.065 8.496-12.125 7" />
        <path d="m5.94 8.504 12.125 7" />
      </g>
    )}
  </svg>
);
