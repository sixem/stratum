// Presents the app identity, project links, and build details.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { APP_ISSUES_URL, APP_REPO_URL } from "@/constants";
import { isEditableElement } from "@/lib";
import { useModalFocusTrap } from "@/hooks";
import { NavArrowIcon, OpenExternalIcon } from "@/components/icons";
import stratumLogo from "@/assets/stratum-logo.webp";
import { DialogCloseButton } from "./DialogCloseButton";
import { ExternalLink } from "./ExternalLink";
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

const buildModeLabel = (mode: string) => {
  const normalized = mode.trim().toLowerCase();
  if (!normalized) return "Unknown";
  if (normalized === "production") return "Release";
  return normalized.replace(/^\w/, (char) => char.toUpperCase());
};

function AboutDialog({
  appName,
  description,
  version,
  buildMode,
  runtime,
  platform,
  onClose,
}: Omit<AboutModalProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const [showNotices, setShowNotices] = useState(false);
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticesButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticesViewportRef = useRef<HTMLDivElement | null>(null);
  const visitedNoticesRef = useRef(false);

  useModalFocusTrap({
    open: true,
    containerRef: panelRef,
    initialFocusRef: closeButtonRef,
  });

  // Keep the same backdrop and restore focus to the action that opened the notices.
  useLayoutEffect(() => {
    if (showNotices) {
      visitedNoticesRef.current = true;
      noticesViewportRef.current?.focus({ preventScroll: true });
    } else if (visitedNoticesRef.current) {
      noticesButtonRef.current?.focus({ preventScroll: true });
    }
  }, [showNotices]);

  useEffect(() => {
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
  }, [onClose]);

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
        className={showNotices ? "notices-panel" : "about-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={showNotices ? undefined : descriptionId}
        ref={panelRef}
        tabIndex={-1}
      >
        {showNotices ? (
          <ThirdPartyNotices
            titleId={titleId}
            viewportRef={noticesViewportRef}
            onBack={() => setShowNotices(false)}
            onClose={onClose}
          />
        ) : (
          <>
            <DialogCloseButton ref={closeButtonRef} className="about-close" label="Close About" onClose={onClose} />
            <header className="about-header">
              <img className="about-logo" src={stratumLogo} alt="" width={64} height={64} />
              <h2 className="about-title" id={titleId}>{appName}</h2>
              <p className="about-version">Version <span className="tnum">{version}</span></p>
            </header>
            <p className="about-description" id={descriptionId}>{description}</p>

            <nav className="about-links" aria-label="About links">
              <ExternalLink href={APP_REPO_URL}>
                Source code <OpenExternalIcon />
              </ExternalLink>
              <ExternalLink href={APP_ISSUES_URL}>
                Report an issue <OpenExternalIcon />
              </ExternalLink>
              <button type="button" ref={noticesButtonRef} onClick={() => setShowNotices(true)}>
                Third-party notices <NavArrowIcon />
              </button>
            </nav>

            <footer className="about-footer">
              <p>{platform} · {runtime} · {buildModeLabel(buildMode)}</p>
              <p>By emy@five.sh</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export const AboutModal = ({ open, ...props }: AboutModalProps) =>
  open ? <AboutDialog {...props} /> : null;
