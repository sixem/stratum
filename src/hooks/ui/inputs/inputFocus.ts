// Returns focus to the surrounding view without changing the field's value.
import type { PointerEvent as ReactPointerEvent } from "react";

const textInputTypes = new Set(["text", "search", "number", "email", "password", "tel", "url"]);

const getFocusedTextField = () => {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement)) return null;
  if (field.isContentEditable || field instanceof HTMLTextAreaElement) return field;
  if (field instanceof HTMLInputElement && textInputTypes.has(field.type)) return field;
  return null;
};

export const isPlainEscape = (event: KeyboardEvent) =>
  event.key === "Escape" && !event.defaultPrevented && !event.isComposing && !event.repeat &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

export const releaseInputFocusOnEscape = (event: KeyboardEvent, view?: HTMLElement | null) => {
  if (!isPlainEscape(event)) return false;
  const field = getFocusedTextField();
  if (!field || field !== event.target) return false;

  // Dialogs keep keyboard focus inside their panel until they close.
  const destination = field.closest<HTMLElement>('[role="dialog"][tabindex]') ?? view;
  event.preventDefault();
  event.stopPropagation();
  if (destination) destination.focus({ preventScroll: true });
  else field.blur();
  return true;
};

const fileViewControls = 'button, a, label, input, textarea, select, [contenteditable], [role="button"], [tabindex="0"], [data-path]';

export const focusFilePaneBackground = (event: ReactPointerEvent<HTMLElement>) => {
  if (event.button !== 0 || !getFocusedTextField()) return;
  if (!(event.target instanceof Element) || event.target.closest(fileViewControls)) return;
  // Marquee selection prevents the pointer event's native focus change.
  event.currentTarget.focus({ preventScroll: true });
};
