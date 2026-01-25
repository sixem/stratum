// Inline rename input with Explorer-like selection behavior.
import { useEffect, useRef } from "react";
import type { RenameCommitReason } from "@/types";
import { splitNameExtension } from "@/lib";

type RenameFieldProps = {
  value: string;
  isDir: boolean;
  className?: string;
  onChange: (value: string) => void;
  onCommit: (reason: RenameCommitReason) => void;
  onCancel: () => void;
};

const getRenameSelection = (name: string, isDir: boolean) => {
  if (isDir) {
    return { start: 0, end: name.length };
  }
  const { base, extension } = splitNameExtension(name);
  if (!extension) {
    return { start: 0, end: name.length };
  }
  return { start: 0, end: base.length };
};

export const RenameField = ({
  value,
  isDir,
  className,
  onChange,
  onCommit,
  onCancel,
}: RenameFieldProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canceledRef = useRef(false);
  const committedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const { start, end } = getRenameSelection(value, isDir);
    input.setSelectionRange(start, end);
  }, []);

  const handleCommit = () => {
    if (canceledRef.current || committedRef.current) return;
    committedRef.current = true;
    onCommit("enter");
  };

  const handleCancel = () => {
    if (canceledRef.current || committedRef.current) return;
    canceledRef.current = true;
    onCancel();
  };

  const handleCommitOnExit = (reason: RenameCommitReason) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(reason);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      className={className ?? "rename-input"}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleCommit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          handleCommitOnExit("escape");
        }
      }}
      onBlur={() => handleCommitOnExit("blur")}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
};
