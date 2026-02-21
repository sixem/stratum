// Error block for unsupported/failed quick preview rendering.
import { PressButton } from "@/components/primitives/PressButton";

type PreviewErrorProps = {
  visible: boolean;
  isVideo: boolean;
  name: string;
  typeLabel: string;
  canUseExternalActions: boolean;
  externalActionError: string | null;
  onOpenExternal: () => void;
  onRevealExternal: () => void;
};

export const PreviewError = ({
  visible,
  isVideo,
  name,
  typeLabel,
  canUseExternalActions,
  externalActionError,
  onOpenExternal,
  onRevealExternal,
}: PreviewErrorProps) => {
  if (!visible) return null;
  const errorTitle = isVideo ? "Video preview unavailable" : "Preview unavailable";
  const errorSummary = isVideo
    ? "Stratum plays videos using your system webview's built-in media decoder."
    : "Stratum previews files using your system webview.";
  const errorDetail = isVideo
    ? "Some containers/codecs (often MKV/H.265/AV1, depending on your OS) are not supported there, so playback can fail."
    : "If the file format is not supported there, rendering can fail.";

  return (
    <div className="quick-preview-error" role="status" aria-live="polite">
      <div className="quick-preview-error-card">
        <div className="quick-preview-error-title">{errorTitle}</div>
        <div className="quick-preview-error-desc">
          {errorSummary} {errorDetail}
        </div>
        <div className="quick-preview-error-meta">
          <div className="quick-preview-error-meta-row">
            <span className="quick-preview-error-meta-label">File</span>
            <span className="quick-preview-error-meta-value">{name}</span>
          </div>
          <div className="quick-preview-error-meta-row">
            <span className="quick-preview-error-meta-label">Type</span>
            <span className="quick-preview-error-meta-value">{typeLabel}</span>
          </div>
        </div>
        {canUseExternalActions ? (
          <div className="quick-preview-error-actions">
            <PressButton type="button" className="btn" onClick={onOpenExternal}>
              Open in default app
            </PressButton>
            <PressButton type="button" className="btn ghost" onClick={onRevealExternal}>
              Reveal in folder
            </PressButton>
          </div>
        ) : null}
        {externalActionError ? (
          <div className="quick-preview-error-hint" role="status">
            {externalActionError}
          </div>
        ) : null}
      </div>
    </div>
  );
};
