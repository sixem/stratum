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

export const ContextOpenFolderIcon = ({ className }: IconProps) => (
  <ContextGlyph name="folder-open" className={className}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </ContextGlyph>
);

export const ContextOpenWithIcon = ({ className }: IconProps) => (
  <ContextGlyph name="text-align-justify" className={className}>
    <path d="M3 5h18" />
    <path d="M3 12h18" />
    <path d="M3 19h18" />
  </ContextGlyph>
);

export const ContextOpenNewTabIcon = ({ className }: IconProps) => (
  <ContextGlyph name="app-window" className={className}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M10 4v4" />
    <path d="M2 8h20" />
    <path d="M6 4v4" />
  </ContextGlyph>
);

export const ContextNewFolderIcon = ({ className }: IconProps) => (
  <ContextGlyph name="folder-plus" className={className}>
    <path d="M12 10v6" />
    <path d="M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </ContextGlyph>
);

export const ContextNewFileIcon = ({ className }: IconProps) => (
  <ContextGlyph name="file-plus" className={className}>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M9 15h6" />
    <path d="M12 18v-6" />
  </ContextGlyph>
);

export const ContextPasteIcon = ({ className }: IconProps) => (
  <ContextGlyph name="clipboard" className={className}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </ContextGlyph>
);

export const ContextPasteIntoFolderIcon = ({ className }: IconProps) => (
  <ContextGlyph name="folder-input" className={className}>
    <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
    <path d="M2 13h10" />
    <path d="m9 16 3-3-3-3" />
  </ContextGlyph>
);

export const ContextPinIcon = ({ className }: IconProps) => (
  <ContextGlyph name="pin" className={className}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </ContextGlyph>
);

export const ContextUnlinkIcon = ({ className }: IconProps) => (
  <ContextGlyph name="unlink" className={className}>
    <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
    <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
    <line x1="8" x2="8" y1="2" y2="5" /><line x1="2" x2="5" y1="8" y2="8" />
    <line x1="16" x2="16" y1="19" y2="22" /><line x1="19" x2="22" y1="16" y2="16" />
  </ContextGlyph>
);

export const Link2Icon = ({ className }: IconProps) => (
  <ContextGlyph name="link-2" className={className}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <line x1="8" x2="16" y1="12" y2="12" />
  </ContextGlyph>
);

export const ContextUnpinIcon = ({ className }: IconProps) => (
  <ContextGlyph name="pin-off" className={className}>
    <path d="M12 17v5" />
    <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
    <path d="m2 2 20 20" />
    <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
  </ContextGlyph>
);

export const ContextTerminalIcon = ({ className }: IconProps) => (
  <ContextGlyph name="square-terminal" className={className}>
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
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

export const ContextSelectSameExtensionIcon = ({ className }: IconProps) => (
  <ContextGlyph name="file-scan" className={className}>
    <path d="M20 10V8a2.4 2.4 0 0 0-.706-1.704l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4.35" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M16 14a2 2 0 0 0-2 2" />
    <path d="M16 22a2 2 0 0 1-2-2" />
    <path d="M20 14a2 2 0 0 1 2 2" />
    <path d="M20 22a2 2 0 0 0 2-2" />
  </ContextGlyph>
);

export const ContextInvertSelectionIcon = ({ className }: IconProps) => (
  <ContextGlyph name="squares-exclude" className={className}>
    <path d="M16 12v2a2 2 0 0 1-2 2H9a1 1 0 0 0-1 1v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h0" />
    <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 1-1 1h-5a2 2 0 0 0-2 2v2" />
  </ContextGlyph>
);

export const ContextPropertiesIcon = ({ className }: IconProps) => (
  <ContextGlyph name="brackets" className={className}>
    <path d="M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3" />
    <path d="M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" />
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
