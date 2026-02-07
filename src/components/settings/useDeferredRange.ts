// Shared range-input behavior so settings changes only commit on release.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

type UseDeferredRangeOptions = {
  value: number;
  onCommit: (value: number) => void;
};

type DeferredRangeBind = {
  value: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onBlur: () => void;
};

export const useDeferredRange = ({ value, onCommit }: UseDeferredRangeOptions) => {
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  const draftRef = useRef(value);
  const draggingRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
    if (draggingRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    const next = draftRef.current;
    if (next === valueRef.current) return;
    onCommit(next);
  }, [onCommit]);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    draftRef.current = next;
    setDraft(next);
  }, []);

  const handlePointerDown = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
    commit();
  }, [commit]);

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    commit();
  }, [commit]);

  const handleBlur = useCallback(() => {
    draggingRef.current = false;
    commit();
  }, [commit]);

  const bind: DeferredRangeBind = {
    value: draft,
    onChange: handleChange,
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onBlur: handleBlur,
  };

  return { draft, bind };
};
