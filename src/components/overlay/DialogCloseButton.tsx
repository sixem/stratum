// Shared close control for dialog headers.
import type { Ref } from "react";
import { WindowCloseIcon } from "@/components/icons";

type DialogCloseButtonProps = {
  className?: string;
  label?: string;
  onClose: () => void;
  ref?: Ref<HTMLButtonElement>;
};

export const DialogCloseButton = ({ className, label = "Close", onClose, ref }: DialogCloseButtonProps) => (
  <button
    ref={ref}
    type="button"
    className={className ? `dialog-close ${className}` : "dialog-close"}
    aria-label={label}
    onClick={onClose}
  >
    <WindowCloseIcon />
  </button>
);
