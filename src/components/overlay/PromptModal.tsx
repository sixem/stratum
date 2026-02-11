// Global prompt modal driven by the prompt store.
import { useEffect, useRef } from "react";
import { isEditableElement } from "@/lib";
import { PressButton } from "@/components/primitives/PressButton";
import { usePromptStore, type PromptConfig } from "@/modules";
import { useModalFocusTrap } from "@/hooks";

type PromptAction = NonNullable<PromptConfig["actions"]>[number];

export const PromptModal = () => {
  const prompt = usePromptStore((state) => state.prompt);
  const hidePrompt = usePromptStore((state) => state.hidePrompt);
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useModalFocusTrap({
    open: Boolean(prompt),
    containerRef: panelRef,
  });

  useEffect(() => {
    if (!prompt) return;
    const confirmLabel = prompt.confirmLabel === undefined ? "OK" : prompt.confirmLabel;
    const showConfirm = Boolean(confirmLabel && confirmLabel.trim().length > 0);
    const cancelLabel =
      prompt.cancelLabel === undefined ? (prompt.onCancel ? "Cancel" : null) : prompt.cancelLabel;
    const showCancel = Boolean(cancelLabel && cancelLabel.trim().length > 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditableElement(document.activeElement)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const lowerKey = event.key.toLowerCase();

      // Enter is the universal confirm shortcut.
      // For explicit confirm/cancel dialogs, also allow `y` (yes) to confirm.
      if (event.key === "Enter" || (lowerKey === "y" && showCancel)) {
        if (!showConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        prompt.onConfirm?.();
        hidePrompt();
        return;
      }

      if (event.key !== "Escape") return;
      if (prompt.blocking) return;
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
  const actions = prompt.actions ?? [];
  const showActions = showConfirm || showCancel || actions.length > 0;

  const handleCancel = () => {
    prompt.onCancel?.();
    hidePrompt();
  };

  const handleConfirm = () => {
    prompt.onConfirm?.();
    hidePrompt();
  };

  const handleAction = (action: PromptAction) => {
    action.onClick();
    if (action.closeOnClick !== false) {
      hidePrompt();
    }
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
        ref={panelRef}
        tabIndex={-1}
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
              <PressButton type="button" className="btn ghost" onClick={handleCancel}>
                {cancelLabel}
              </PressButton>
            ) : null}
            {actions.map((action, index) => {
              const variant = action.variant ?? "ghost";
              const className = variant === "ghost" ? "btn ghost" : "btn";
              return (
                <PressButton
                  key={`${action.label}-${index}`}
                  type="button"
                  className={className}
                  onClick={() => handleAction(action)}
                >
                  {action.label}
                </PressButton>
              );
            })}
            {showConfirm ? (
              <PressButton type="button" className="btn" onClick={handleConfirm}>
                {confirmLabel}
              </PressButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
