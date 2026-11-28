// Runs a resolved transfer and reports its progress and outcome to the UI.
import { transferEntries } from "@/api";
import {
  formatFailures,
  getParentPath,
  normalizeDropPath,
} from "@/lib";
import { bumpDirectoryChildVersions } from "@/modules";
import { recordMoveDestination } from "@/modules/recentMoveStore";
import type { PromptConfig } from "@/modules";
import type { FileJobRegistration } from "@/modules/transferStore";
import type { CreatedFolder } from "@/types/fs";
import type { UndoMoveEntry } from "./fileManagerUndo";
import {
  getTransferErrorMessage,
  isTransferCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";
import type { ResolvedDropTransferPlan } from "./dropTransferPlanning";

type PromptStoreLike = {
  showPrompt: (prompt: PromptConfig) => void;
};

type TransferJobStoreLike = {
  registerTransferJob: (input: { label: string; items: string[]; kind: "transfer" }) => FileJobRegistration;
  updateTransferLabel: (id: string, label: string) => void;
  recordTransferJobOutcome: (
    id: string,
    patch: Partial<{ copied: number; moved: number; skipped: number; failures: number }>,
  ) => void;
};

type RunDropTransferOptions = {
  plan: ResolvedDropTransferPlan;
  dropStage?: number;
  protectedFolder?: CreatedFolder;
  moveHistoryWorkspace?: string | null;
  promptStore: PromptStoreLike;
  currentPathKey: string;
  onRefresh?: () => void;
  onRecordMoveUndo?: (entries: UndoMoveEntry[]) => void;
  transferStore: TransferJobStoreLike;
};

const shouldRefreshTransferView = (
  plan: ResolvedDropTransferPlan,
  currentPathKey: string,
  includeSourceParents: boolean,
) => {
  const touchedCurrentDestination = plan.destinationKey === currentPathKey;
  const touchedCurrentSource =
    includeSourceParents &&
    plan.items.some((item) => {
      const parent = getParentPath(item.candidate.path) ?? "";
      return normalizeDropPath(parent) === currentPathKey;
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
  dropStage,
  protectedFolder,
  moveHistoryWorkspace,
  promptStore,
  currentPathKey,
  onRefresh,
  onRecordMoveUndo,
  transferStore,
}: RunDropTransferOptions) => {
  const job = transferStore.registerTransferJob({
    label: plan.mode === "move" ? "Move" : plan.mode === "copy" ? "Copy" : "Transfer",
    items: plan.items.map((item) => item.candidate.path),
    kind: "transfer",
  });

  try {
    // Conflict planning and execution must honor the same negotiated operation.
    const report = await transferEntries(
      plan.items.map((item) => item.candidate.path),
      plan.destination,
      { mode: plan.mode, overwritePaths: plan.overwritePaths, skippedByPrompt: plan.skippedByPrompt, protectedFolder },
      job.id,
      dropStage,
    );
    const label =
      report.moved > 0 && report.copied === 0
        ? "Move"
        : report.copied > 0 && report.moved === 0
          ? "Copy"
          : "Transfer";

    transferStore.updateTransferLabel(job.id, label);
    transferStore.recordTransferJobOutcome(job.id, {
      copied: report.copied,
      moved: report.moved,
      skipped: report.skipped + plan.skippedByPrompt,
      failures: report.failures.length,
    });
    if (report.movedEntries.length > 0) {
      recordMoveDestination(moveHistoryWorkspace, plan.destination);
      onRecordMoveUndo?.(
        report.movedEntries.flatMap((entry) => entry.identity ? [{
          from: entry.sourcePath, to: entry.destinationPath, identity: entry.identity,
        }] : []),
      );
    }

    if (report.failures.length > 0) {
      promptStore.showPrompt({
        title: `${label} ${report.cancelled ? "cancelled" : "completed"} with issues`,
        content: formatFailures(report.failures),
        confirmLabel: "OK",
        cancelLabel: null,
      });
    }

    if (report.cancelled || report.moved > 0 || report.copied > 0) {
      // A move can publish its copy and keep newly changed entries at the source.
      const includeSourceParents = report.cancelled || report.moved > 0 ||
        (report.failures.length > 0 && plan.items.some((item) => item.shouldMove));
      if (shouldRefreshTransferView(plan, currentPathKey, includeSourceParents)) {
        onRefresh?.();
      }
      bumpTransferDirectoryChildren(plan, { includeSourceParents });
    }
    return report;
  } catch (error) {
    if (isTransferCancelledError(error)) {
      if (shouldRefreshTransferView(plan, currentPathKey, true)) {
        onRefresh?.();
      }
      bumpTransferDirectoryChildren(plan, { includeSourceParents: true });
      return;
    }

    transferStore.recordTransferJobOutcome(job.id, { failures: 1 });
    promptStore.showPrompt({
      title: "Transfer failed",
      content: getTransferErrorMessage(error, "Failed to transfer selected items."),
      confirmLabel: "OK",
      cancelLabel: null,
    });
  } finally {
    job.finish();
  }
};
