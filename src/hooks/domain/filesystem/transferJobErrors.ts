// Shared helpers for interpreting backend-managed operation failures.
// Intentional cancellation should not be surfaced as a generic error prompt.
const MANAGED_JOB_CANCELLED_MESSAGE = "Transfer cancelled";

export const isManagedJobCancelledError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message.trim() === MANAGED_JOB_CANCELLED_MESSAGE;
  }
  if (typeof error === "string") {
    return error.trim() === MANAGED_JOB_CANCELLED_MESSAGE;
  }
  return false;
};

export const getManagedJobErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
};

export const isTransferCancelledError = isManagedJobCancelledError;

export const getTransferErrorMessage = getManagedJobErrorMessage;
