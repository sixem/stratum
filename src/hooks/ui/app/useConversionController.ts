// App-level conversion workflow orchestration.
// The modal owns draft state; the backend work queue owns live job execution.
import { useCallback, useEffect, useRef, useState } from "react";
import { convertMediaEntries, statEntries } from "@/api";
import { formatFailures, toMessage } from "@/lib";
import { isManagedJobCancelledError, getManagedJobErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { usePromptStore, useTransferStore } from "@/modules";
import type { ConversionModalDraft, ConversionModalRequest } from "@/types";
import {
  buildConversionModalDraft,
  buildConversionRunState,
} from "./conversion/conversionDrafts";
import { prepareConversionJob } from "./conversion/prepareConversionJob";
import { failedConversionDraft } from "./conversion/conversionRetry";

type ConversionModalState = {
  open: boolean;
  request: ConversionModalRequest | null;
  uiDraft: ConversionModalDraft | null;
  run: ReturnType<typeof buildConversionRunState> | null;
};

type UseConversionControllerOptions = {
  refreshEntries: () => Promise<unknown> | unknown;
  ffmpegPath: string;
};

type ConversionFeedbackMode = "modal" | "prompt";

const buildClosedConversionState = (): ConversionModalState => ({
  open: false,
  request: null,
  uiDraft: null,
  run: null,
});

export const useConversionController = ({
  refreshEntries,
  ffmpegPath,
}: UseConversionControllerOptions) => {
  const [conversionModalState, setConversionModalState] = useState<ConversionModalState>(
    buildClosedConversionState,
  );
  const preparationRef = useRef<AbortController | null>(null);

  const registerTransferJob = useTransferStore((state) => state.registerJob);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);
  // Folder reads have their own error feedback. A refresh must not change the outcome of an encode.
  const refreshAfterConversion = useCallback(
    () => Promise.resolve().then(refreshEntries).catch(() => {}),
    [refreshEntries],
  );

  useEffect(() => () => preparationRef.current?.abort(), []);

  const showPrompt = useCallback((title: string, content: string) => {
    usePromptStore.getState().showPrompt({
      title,
      content,
      confirmLabel: "OK",
      cancelLabel: null,
    });
  }, []);

  const setModalFailure = useCallback(
    (request: ConversionModalRequest, draft: ConversionModalDraft, message: string) => {
      setConversionModalState({
        open: true,
        request,
        uiDraft: draft,
        run: buildConversionRunState(request, {
          phase: "failed",
          message,
        }),
      });
    },
    [],
  );

  const openConversionModal = useCallback((request: ConversionModalRequest, draft = buildConversionModalDraft(request)) => {
    preparationRef.current?.abort();
    preparationRef.current = null;
    setConversionModalState({
      open: true,
      request,
      uiDraft: draft,
      run: buildConversionRunState(request),
    });
  }, []);

  const closeConversionModal = useCallback(() => {
    preparationRef.current?.abort();
    preparationRef.current = null;
    setConversionModalState(buildClosedConversionState());
  }, []);

  const handleConversionDraftChange = useCallback((draft: ConversionModalDraft) => {
    setConversionModalState((prev) => {
      if (!prev.request || preparationRef.current) {
        return prev;
      }
      return {
        ...prev,
        uiDraft: draft,
        run: buildConversionRunState(prev.request),
      };
    });
  }, []);

  const queueConversionJob = useCallback(
    async (
      request: ConversionModalRequest,
      draft: ConversionModalDraft,
      feedbackMode: ConversionFeedbackMode,
    ) => {
      const preparation = feedbackMode === "modal" ? new AbortController() : null;
      if (preparation) {
        if (preparationRef.current) return;
        preparationRef.current = preparation;
        setConversionModalState({
          open: true, request, uiDraft: draft,
          run: buildConversionRunState(request, { phase: "running", message: "Checking output filenames…" }),
        });
      }
      let preparedJob;
      try {
        preparedJob = await prepareConversionJob({
          draft,
          ffmpegPath,
          statEntries,
          signal: preparation?.signal,
        });
        if (preparation?.signal.aborted) return;
      } catch (error) {
        if (preparation?.signal.aborted) return;
        const message = toMessage(error, "Failed to prepare conversion.");
        if (feedbackMode === "modal") {
          setModalFailure(request, draft, message);
        } else {
          showPrompt("Conversion failed", message);
        }
        return;
      } finally {
        if (preparationRef.current === preparation) preparationRef.current = null;
      }

      const job = registerTransferJob({
        label: preparedJob.label,
        items: preparedJob.sourcePaths,
      });

      if (feedbackMode === "modal") {
        setConversionModalState(buildClosedConversionState());
      }

      void (async () => {
        try {
          const report = await convertMediaEntries(preparedJob.items, job.id);
          recordTransferJobOutcome(job.id, {
            copied: report.converted,
            failures: report.failures.length,
          });

          if (report.failures.length || report.warnings.length) {
            const retry = failedConversionDraft(request, draft, report.failedSources);
            const failed = report.failed;
            const failedTitle = report.converted ? `${report.converted} converted, ${failed} failed` : "Conversion failed";
            const sections = [
              report.failures.length ? formatFailures(report.failures) : "",
              report.warnings.length ? `Output saved. Cleanup needs attention.\n${formatFailures(report.warnings)}` : "",
            ];
            usePromptStore.getState().showPrompt({
              title: failed ? failedTitle : "Conversion finished with a warning",
              content: sections.filter(Boolean).join("\n\n"),
              confirmLabel: retry ? "Review failed files" : "Close",
              cancelLabel: retry ? "Close" : null,
              onConfirm: retry ? () => openConversionModal(retry.request, retry.draft) : undefined,
            });
          }

          if (report.converted > 0) {
            void refreshAfterConversion();
          }
        } catch (error) {
          if (isManagedJobCancelledError(error)) {
            void refreshAfterConversion();
            return;
          }
          recordTransferJobOutcome(job.id, { failures: 1 });
          showPrompt(
            "Conversion failed",
            getManagedJobErrorMessage(error, "Failed to convert selected items."),
          );
        }
      })();
    },
    [
      ffmpegPath,
      openConversionModal,
      recordTransferJobOutcome,
      refreshAfterConversion,
      registerTransferJob,
      setModalFailure,
      showPrompt,
    ],
  );

  const handleStartConversion = useCallback((draft: ConversionModalDraft) => {
    const request = conversionModalState.request;
    if (!request) return;
    void queueConversionJob(request, draft, "modal");
  }, [conversionModalState.request, queueConversionJob]);

  const handleQuickConvertImages = useCallback(
    (request: ConversionModalRequest, targetFormat: string) => {
      const quickRequest: ConversionModalRequest = {
        ...request,
        quickTargetFormat: targetFormat,
        quickTargetKind: "image",
      };
      const quickDraft = buildConversionModalDraft(quickRequest);
      quickDraft.outputMode = "replace";
      quickDraft.imageOptions.quality = 100;
      quickDraft.rules = quickDraft.rules.map((rule) =>
        rule.kind === "image" ? { ...rule, targetFormat } : rule,
      );
      void queueConversionJob(quickRequest, quickDraft, "prompt");
    },
    [queueConversionJob],
  );

  return {
    conversionModalOpen: conversionModalState.open,
    conversionModalState,
    openConversionModal,
    closeConversionModal,
    handleConversionDraftChange,
    handleStartConversion,
    handleQuickConvertImages,
  };
};
