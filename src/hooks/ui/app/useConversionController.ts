// App-level conversion workflow orchestration.
// The modal owns draft state; the backend work queue owns live job execution.
import { useCallback, useEffect, useRef, useState } from "react";
import { convertMediaEntries } from "@/api";
import { formatFailures, toMessage } from "@/lib";
import { isManagedJobCancelledError, getManagedJobErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { usePromptStore, useTransferStore } from "@/modules";
import type { ConversionModalDraft, ConversionModalRequest } from "@/types";
import {
  buildConversionModalDraft,
  buildConversionRunState,
} from "./conversion/conversionDrafts";
import { prepareConversionJob } from "./conversion/prepareConversionJob";

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
  const conversionStateRef = useRef(conversionModalState);

  const registerTransferJob = useTransferStore((state) => state.registerJob);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);

  useEffect(() => {
    conversionStateRef.current = conversionModalState;
  }, [conversionModalState]);

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

  const openConversionModal = useCallback((request: ConversionModalRequest) => {
    setConversionModalState({
      open: true,
      request,
      uiDraft: buildConversionModalDraft(request),
      run: buildConversionRunState(request),
    });
  }, []);

  const closeConversionModal = useCallback(() => {
    setConversionModalState(buildClosedConversionState());
  }, []);

  const handleConversionDraftChange = useCallback((draft: ConversionModalDraft) => {
    setConversionModalState((prev) => {
      if (!prev.request) {
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
      let preparedJob;
      try {
        preparedJob = await prepareConversionJob({
          request,
          draft,
          ffmpegPath,
        });
      } catch (error) {
        const message = toMessage(error, "Failed to prepare conversion.");
        if (feedbackMode === "modal") {
          setModalFailure(request, draft, message);
        } else {
          showPrompt("Conversion failed", message);
        }
        return;
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

          if (report.failures.length > 0) {
            showPrompt(
              "Conversion completed with issues",
              formatFailures(report.failures),
            );
          }

          if (report.converted > 0) {
            await refreshEntries();
          }
        } catch (error) {
          if (isManagedJobCancelledError(error)) {
            await refreshEntries();
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
      recordTransferJobOutcome,
      refreshEntries,
      registerTransferJob,
      setModalFailure,
      showPrompt,
    ],
  );

  const handleStartConversion = useCallback(() => {
    const snapshot = conversionStateRef.current;
    const request = snapshot.request;
    const draft = snapshot.uiDraft;
    if (!request || !draft) return;
    void queueConversionJob(request, draft, "modal");
  }, [queueConversionJob]);

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
