// A caption gives the input an accessible name without taking focus on click.
import { useId } from "react";
import type { ComponentPropsWithRef } from "react";

type BatchRenameInputProps = ComponentPropsWithRef<"input"> & { caption: string };

export const BatchRenameInput = ({ caption, ...inputProps }: BatchRenameInputProps) => {
  const captionId = useId();
  return (
    <div className="batch-rename-field">
      <span id={captionId}>{caption}</span>
      <input {...inputProps} aria-labelledby={captionId} />
    </div>
  );
};
