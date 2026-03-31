// Runs a planned drag-and-drop transfer and reports the outcome back to UI state.
import { transferEntries } from "@/api";
import {
  formatFailures,
  getParentPath,
  normalizePath,
} from "@/lib";
import { bumpDirectoryChildVersions } from "@/modules";
import type { PromptConfig } from "@/modules";
import {
  getTransferErrorMessage,
  isTransferCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";
import type { ResolvedDropTransferPlan } from "./dropTransferPlanning";

type PromptStoreLike = {
  showPrompt: (prompt: PromptConfig) => void;
};

type TransferJobStoreLike = {
  registerTransferJob: (input: { label: string; items?: string[] }) => { id: string };
  updateTransferLabel: (id: string, label: string) => void;
  recordTransferJobOutcome: (
    id: string,
    patch: Partial<{ copied: number; moved: number; skipped: number; failures: number }>,
  ) => void;
};

type RunDropTransferOptions = {
  plan: ResolvedDropTransferPlan;
  promptStore: PromptStoreLike;
  currentPathKey: string;
  onRefresh?: () => void;
  transferStore: TransferJobStoreLike;
};

const shouldRefreshForTransfer = (
  plan: ResolvedDropTransferPlan,
  currentPathKey: string,
  movedCount: number,
  copiedCount: number,
) => {
  const touchedCurrentDestination =
    plan.destinationKey === currentPathKey && (movedCount > 0 || copiedCount > 0);
  const touchedCurrentSource =
    movedCount > 0 &&
    plan.items.some((item) => {
      const parent = getParentPath(item.candidate.path) ?? "";
      return normalizePath(parent) === currentPathKey;
    });

  return touchedCurrentDestination || touchedCurrentSource;
};

const shouldRefreshAfterCancellation = (
  plan: ResolvedDropTransferPlan,
  currentPathKey: string,
) => {
  const touchedCurrentDestination = plan.destinationKey === currentPathKey;
  const touchedCurrentSource = plan.items.some((item) => {
    const parent = getParentPath(item.candidate.path) ?? "";
    return normalizePath(parent) === currentPathKey;
  });

  return touchedCurrentDestination || touchedCurrentSource;
};

const bumpTransferDirectoryChildren = (
  plan: ResolvedDropTransferPlan,
  options: { includeSourceParents: boolean },
) => {
  const paths = [plan.destination];
  if (options.includeSourceParents) {
    plan.items.forEach((item) => {
      const parent = getParentPath(item.candidate.path);
      if (parent) {
        paths.push(parent);
      }
    });
  }
  bumpDirectoryChildVersions(paths);
};

export const runDropTransfer = async ({
  plan,
  promptStore,
  currentPathKey,
  onRefresh,
  transferStore,
}: RunDropTransferOptions) => {
  const job = transferStore.registerTransferJob({
    label: "Transfer",
    items: plan.items.map((item) => item.candidate.path),
  });

  try {
    // Use auto mode so same-drive drops move and cross-drive drops copy.
    const report = await transferEntries(
      plan.items.map((item) => item.candidate.path),
      plan.destination,
      { mode: "auto", overwrite: plan.overwrite },
      job.id,
    );
    const label =
      report.moved > 0 && report.copied > 0
        ? "Transfer"
        : report.moved > 0
          ? "Move"
          : "Copy";

    transferStore.updateTransferLabel(job.id, label);
    transferStore.recordTransferJobOutcome(job.id, {
      copied: report.copied,
      moved: report.moved,
      skipped: report.skipped + plan.skippedByPrompt,
      failures: report.failures.length,
    });

    if (report.failures.length > 0) {
      promptStore.showPrompt({
        title: `${label} completed with issues`,
        content: formatFailures(report.failures),
        confirmLabel: "OK",
        cancelLabel: null,
      });
    }

    if (
      shouldRefreshForTransfer(plan, currentPathKey, report.moved ?? 0, report.copied ?? 0)
    ) {
      onRefresh?.();
    }
    if ((report.moved ?? 0) > 0 || (report.copied ?? 0) > 0) {
      bumpTransferDirectoryChildren(plan, {
        includeSourceParents: (report.moved ?? 0) > 0,
      });
    }
  } catch (error) {
    if (isTransferCancelledError(error)) {
      if (shouldRefreshAfterCancellation(plan, currentPathKey)) {
        onRefresh?.();
      }
      bumpTransferDirectoryChildren(plan, { includeSourceParents: true });
      return;
    }

    transferStore.recordTransferJobOutcome(job.id, { failures: 1 });
    promptStore.showPrompt({
      title: "Transfer failed",
      content: getTransferErrorMessage(error, "Failed to transfer dropped items."),
      confirmLabel: "OK",
      cancelLabel: null,
    });
  }
};
