// Lucide glyphs supplied for the custom context menu.
import type { ReactNode } from "react";
import type { IconProps } from "./types";

type ContextGlyphProps = IconProps & { name: string; children: ReactNode };

const ContextGlyph = ({ name, className, children }: ContextGlyphProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={["lucide", `lucide-${name}`, className].filter(Boolean).join(" ")}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ContextOpenIcon = ({ className }: IconProps) => (
  <ContextGlyph name="external-link" className={className}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </ContextGlyph>
);

export const ContextCutIcon = ({ className }: IconProps) => (
  <ContextGlyph name="scissors" className={className}>
    <circle cx="6" cy="6" r="3" />
    <path d="M8.12 8.12 12 12" />
    <path d="M20 4 8.12 15.88" />
    <circle cx="6" cy="18" r="3" />
    <path d="M14.8 14.8 20 20" />
  </ContextGlyph>
);

export const ContextRenameIcon = ({ className }: IconProps) => (
  <ContextGlyph name="pencil" className={className}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </ContextGlyph>
);

export const ContextPropertiesIcon = ({ className }: IconProps) => (
  <ContextGlyph name="table-properties" className={className}>
    <path d="M15 3v18" />
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M21 9H3" />
    <path d="M21 15H3" />
  </ContextGlyph>
);

export const ContextGalleryIcon = ({ className }: IconProps) => (
  <ContextGlyph name="image" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </ContextGlyph>
);

export const ContextMoreOptionsIcon = ({ className }: IconProps) => (
  <ContextGlyph name="ellipsis" className={className}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </ContextGlyph>
);
