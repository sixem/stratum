// Use the system browser for external links in the desktop app.
import type { MouseEvent, ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const url = event.currentTarget.href;
    event.preventDefault();
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  };

  return <a href={href} target="_blank" rel="noreferrer" onClick={handleClick}>{children}</a>;
}
