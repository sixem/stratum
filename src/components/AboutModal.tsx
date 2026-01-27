// Simple about dialog showing app and build metadata.
import type { MouseEvent } from "react";
import { useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-opener";
import { isEditableElement } from "@/lib";

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

const GITHUB_URL = "https://github.com/sixem/";

const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const buildModeLabel = (mode: string) => {
  const normalized = mode.trim().toLowerCase();
  if (!normalized) return "Unknown";
  if (normalized === "production") return "Release";
  return normalized.replace(/^\w/, (char) => char.toUpperCase());
};

export function AboutModal({
  open,
  appName,
  description,
  version,
  buildMode,
  runtime,
  platform,
  onClose,
}: AboutModalProps) {
  const shouldCloseRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

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
    event.preventDefault();
    try {
      await open(GITHUB_URL);
    } catch {
      window.open(GITHUB_URL, "_blank", "noreferrer");
    }
  };

  if (!open) return null;

  return (
    <div
      className="about-modal"
      data-open={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
      onMouseDown={(event) => {
        shouldCloseRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (shouldCloseRef.current) {
          onClose();
        }
        shouldCloseRef.current = false;
      }}
    >
      <div
        className="about-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="about-header">
          <div className="about-mark">
            <img src="/favicon.png" alt="" aria-hidden="true" />
          </div>
          <div>
            <div className="about-title" id="about-title">
              {appName}
            </div>
            <div className="about-subtitle">{description}</div>
          </div>
        </header>

        <div className="about-meta">
          <div className="about-row">
            <span className="about-label">Version</span>
            <span className="about-value">{version}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Build</span>
            <span className="about-value">{buildModeLabel(buildMode)}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Runtime</span>
            <span className="about-value">{runtime}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Platform</span>
            <span className="about-value">{platform}</span>
          </div>
        </div>

        <div className="about-links">
          <span className="about-label">GitHub</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            onClick={handleLinkClick}
          >
            emy
          </a>
        </div>

        <div className="about-footer">Built with Tauri + React.</div>

        <div className="about-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="btn"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
