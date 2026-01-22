// Global prompt modal driven by the prompt store.
import { useEffect, useRef } from "react";
import { usePromptStore } from "@/modules";

export function PromptModal() {
  const prompt = usePromptStore((state) => state.prompt);
  const hidePrompt = usePromptStore((state) => state.hidePrompt);
  const shouldCloseRef = useRef(false);

  useEffect(() => {
    if (!prompt || prompt.blocking) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      prompt.onCancel?.();
      hidePrompt();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [hidePrompt, prompt]);

  if (!prompt) return null;

  const confirmLabel = prompt.confirmLabel === undefined ? "OK" : prompt.confirmLabel;
  const cancelLabel =
    prompt.cancelLabel === undefined ? (prompt.onCancel ? "Cancel" : null) : prompt.cancelLabel;
  const showConfirm = Boolean(confirmLabel && confirmLabel.trim().length > 0);
  const showCancel = Boolean(cancelLabel && cancelLabel.trim().length > 0);
  const showActions = showConfirm || showCancel;

  const handleCancel = () => {
    prompt.onCancel?.();
    hidePrompt();
  };

  const handleConfirm = () => {
    prompt.onConfirm?.();
    hidePrompt();
  };

  return (
    <div
      className="prompt-modal"
      data-open="true"
      aria-hidden="false"
      onMouseDown={(event) => {
        shouldCloseRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (!prompt.blocking && shouldCloseRef.current) {
          handleCancel();
        }
        shouldCloseRef.current = false;
      }}
    >
      <div
        className="prompt-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={prompt.title ? "prompt-title" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {prompt.title ? (
          <div className="prompt-title" id="prompt-title">
            {prompt.title}
          </div>
        ) : null}
        <div className="prompt-content">{prompt.content}</div>
        {showActions ? (
          <div className="prompt-actions">
            {showCancel ? (
              <button type="button" className="btn ghost" onClick={handleCancel}>
                {cancelLabel}
              </button>
            ) : null}
            {showConfirm ? (
              <button type="button" className="btn" onClick={handleConfirm}>
                {confirmLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
