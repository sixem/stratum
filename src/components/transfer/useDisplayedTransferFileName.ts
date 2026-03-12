// Smooths the visible transfer file name so fast batches stay readable.
// The underlying progress still updates immediately; only the text label lags slightly.
import { useEffect, useRef, useState } from "react";
import type { TransferStatus } from "@/modules/transferStore";

type UseDisplayedTransferFileNameOptions = {
  fileName: string | null;
  status: TransferStatus;
  minDwellMs?: number;
};

const DEFAULT_TRANSFER_FILE_DWELL_MS = 220;

export const useDisplayedTransferFileName = ({
  fileName,
  status,
  minDwellMs = DEFAULT_TRANSFER_FILE_DWELL_MS,
}: UseDisplayedTransferFileNameOptions) => {
  const [displayedFileName, setDisplayedFileName] = useState<string | null>(
    fileName,
  );
  const displayedAtRef = useRef(Date.now());

  useEffect(() => {
    if (status !== "running") {
      setDisplayedFileName(fileName);
      displayedAtRef.current = Date.now();
      return;
    }

    if (fileName == null || displayedFileName == null) {
      if (fileName === displayedFileName) {
        return;
      }
      setDisplayedFileName(fileName);
      displayedAtRef.current = Date.now();
      return;
    }

    if (fileName === displayedFileName) {
      return;
    }

    const elapsedMs = Date.now() - displayedAtRef.current;
    const remainingMs = Math.max(minDwellMs - elapsedMs, 0);

    if (remainingMs === 0) {
      setDisplayedFileName(fileName);
      displayedAtRef.current = Date.now();
      return;
    }

    // Keep only the latest pending name so tiny files do not flash past unreadably.
    const timer = window.setTimeout(() => {
      setDisplayedFileName(fileName);
      displayedAtRef.current = Date.now();
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [displayedFileName, fileName, minDwellMs, status]);

  return displayedFileName;
};
