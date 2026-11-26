// Opened explicitly from Settings or the status bar. Background checks never take focus.
import { useId, useRef } from "react";
import { APP_VERSION } from "@/constants";
import { useModalFocusTrap } from "@/hooks";
import { isPlainEscape } from "@/hooks/ui/inputs/inputFocus";
import { useSettingsStore } from "@/modules/settings.store";
import { useUpdateStore } from "@/modules/updateStore";
import { PressButton } from "@/components/primitives/PressButton";
import { DialogCloseButton } from "./DialogCloseButton";
import { OverlayPanelHeader } from "./OverlayPanelHeader";

const actionLabels = {
  install: "Update and restart",
  portable: "Download portable EXE",
  msi: "Download MSI",
} as const;

function publicationLabel(hours: number) {
  if (hours < 1) return "Published less than an hour ago";
  if (hours < 24) return `Published ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Published ${days} day${days === 1 ? "" : "s"} ago`;
}

export const UpdateDialog = () => {
  const { status, release, message, close, apply, checkManually, confirmRestart } = useUpdateStore();
  const delay = useSettingsStore((state) => state.updateDelayHours);
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const backdropDown = useRef(false);
  const titleId = useId();
  useModalFocusTrap({ open: true, containerRef: panel, initialFocusRef: closer });

  const showRelease = release && (status === "available" || status === "confirmTerminals" || status === "applying");
  const published = release && new Date(release.publishedAt);
  const age = published && Math.floor((Date.now() - published.getTime()) / 3_600_000);
  const confirming = status === "confirmTerminals";
  const applying = status === "applying";
  const title = confirming ? "Close terminals and restart?" : showRelease ? `Stratum ${release.version}` : "Software updates";
  const feedback = confirming ? "Restarting will close running terminal sessions."
    : message || (status === "checking" ? "Checking for updates…"
      : status === "current" ? "You’re up to date."
      : applying ? (release?.action === "install" ? "Preparing the update…" : "Opening the download…")
      : status === "error" ? "Couldn’t check for updates." : "");
  return (
    <div className="update-modal" onMouseDown={(event) => {
      backdropDown.current = event.button === 0 && event.target === event.currentTarget;
    }} onClick={(event) => {
      if (backdropDown.current && event.target === event.currentTarget && !applying) close();
      backdropDown.current = false;
    }}>
      <div className="update-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} ref={panel} onKeyDown={(event) => {
          if (!isPlainEscape(event.nativeEvent)) return;
          // Keep Escape inside the top dialog when Settings opened the manual check.
          event.preventDefault();
          event.stopPropagation();
          if (!applying) close();
        }}>
        <OverlayPanelHeader title={title} titleId={titleId}
          subtitle={`Installed version ${APP_VERSION}`}
          actions={!applying && <DialogCloseButton ref={closer} label="Close updates" onClose={close} />} />
        {showRelease && !confirming && (
          <div className="update-details">
            {published && age !== null && (
              <p className="update-published">
                <time dateTime={release.publishedAt} title={published.toLocaleString()}>{publicationLabel(age)}</time>
                {age < delay && <span> · Your update delay is {delay === 24 ? "24 hours" : `${delay / 24} days`}.</span>}
              </p>
            )}
            {release.notes && (
              <section className="update-notes" aria-label="Release notes">
                <h3>Release notes</h3>
                <p>{release.notes}</p>
              </section>
            )}
          </div>
        )}
        {feedback && <p className="update-feedback" role={status === "error" ? "alert" : "status"}>{feedback}</p>}
        {!applying && (
          <footer className="update-actions">
            <PressButton type="button" className="btn ghost" onClick={close}>
              {confirming ? "Cancel" : status === "available" ? "Later" : "Close"}
            </PressButton>
            {status === "error" && <PressButton type="button" className="btn" onClick={() => void checkManually()}>
              Try again
            </PressButton>}
            {status === "available" && release && <PressButton type="button" className="btn" onClick={() => void apply()}>
              {actionLabels[release.action]}
            </PressButton>}
            {confirming && <PressButton type="button" className="btn" onClick={() => void confirmRestart()}>
              Close terminals and restart
            </PressButton>}
          </footer>
        )}
      </div>
    </div>
  );
};
