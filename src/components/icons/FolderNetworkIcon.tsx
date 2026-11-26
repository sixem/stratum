import type { IconProps } from "./types";

export function FolderNetworkIcon({ className }: IconProps) {
  return <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 14v4" /><path d="M17 4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z" />
    <path d="M21 20h-7M3 20h7" /><circle cx="12" cy="20" r="2" />
  </svg>;
}
