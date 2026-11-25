// Presents the app identity, project links, and build details.
import type { MouseEvent } from "react";
import { useEffect, useId, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_ISSUES_URL, APP_REPO_URL } from "@/constants";
import { isEditableElement } from "@/lib";
import { useModalFocusTrap } from "@/hooks";
import { OpenExternalIcon } from "@/components/icons";
import stratumLogo from "@/assets/stratum-logo.webp";
import { DialogCloseButton } from "./DialogCloseButton";
import { ThirdPartyNotices } from "./ThirdPartyNotices";

type AboutModalProps = {
  open: boolean;
  appName: string;
  description: string;
  version: string;
  buildMode: string;
  runtime: string;
  platform: string;
  onClose: () => void;
};

const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const buildModeLabel = (mode: string) => {
  const normalized = mode.trim().toLowerCase();
  if (!normalized) return "Unknown";
  if (normalized === "production") return "Release";
  return normalized.replace(/^\w/, (char) => char.toUpperCase());
};

export const AboutModal = ({
  open,
  appName,
  description,
  version,
  buildMode,
  runtime,
  platform,
  onClose,
}: AboutModalProps) => {
  const titleId = useId();
  const descriptionId = useId();
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditableElement(document.activeElement)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose, open]);

  const handleLinkClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauriEnv()) return;
    const url = event.currentTarget.href;
    event.preventDefault();
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  };

  if (!open) return null;

  return (
    <div
      className="about-modal"
      data-open="true"
      onMouseDown={(event) => {
        shouldCloseRef.current = event.button === 0 && event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const close = shouldCloseRef.current && event.target === event.currentTarget;
        shouldCloseRef.current = false;
        if (close) onClose();
      }}
    >
      <div
        className="about-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={panelRef}
        tabIndex={-1}
      >
        <DialogCloseButton
          ref={closeButtonRef}
          className="about-close"
          label="Close About"
          onClose={onClose}
        />
        <header className="about-header">
          <img className="about-logo" src={stratumLogo} alt="" width={64} height={64} />
          <h2 className="about-title" id={titleId}>{appName}</h2>
          <p className="about-version">Version <span className="tnum">{version}</span></p>
        </header>
        <p className="about-description" id={descriptionId}>{description}</p>

        <nav className="about-links" aria-label="Project links">
          <a href={APP_REPO_URL} target="_blank" rel="noreferrer" onClick={handleLinkClick}>
            Source code <OpenExternalIcon />
          </a>
          <a href={APP_ISSUES_URL} target="_blank" rel="noreferrer" onClick={handleLinkClick}>
            Report an issue <OpenExternalIcon />
          </a>
        </nav>

        <ThirdPartyNotices />

        <footer className="about-footer">
          <p>{platform} · {runtime} · {buildModeLabel(buildMode)}</p>
          <p>By emy@five.sh</p>
        </footer>
      </div>
    </div>
  );
};
