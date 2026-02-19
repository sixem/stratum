// App-level conversion workflow orchestration (modal state + media conversion execution).
import { useCallback, useEffect, useRef, useState } from "react";
import { convertImage, convertVideo, statEntries } from "@/api";
import { getParentPath, joinPath, splitNameExtension, toMessage } from "@/lib";
import { useTransferStore } from "@/modules";
import type {
  ConversionItemDraft,
  ConversionItemRunStatus,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionRunState,
  ImageTargetFormat,
  VideoConvertOptions,
} from "@/types";
import {
  buildConversionModalDraft,
  buildConversionRunState,
  resolveImageTargetSpec,
  resolveVideoTargetSpec,
  toPathKey,
} from "./conversion/conversionDrafts";

type ConversionModalState = {
  open: boolean;
  request: ConversionModalRequest | null;
  uiDraft: ConversionModalDraft | null;
  run: ConversionRunState | null;
};

type UseConversionControllerOptions = {
  deleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  refreshEntries: () => Promise<unknown> | unknown;
  ffmpegPath: string;
};

type ItemConversionTarget =
  | {
      kind: "image";
      extension: string;
      format: ImageTargetFormat;
      quality: number | null;
    }
  | {
      kind: "video";
      extension: string;
      options: Omit<VideoConvertOptions, "overwrite">;
    };

const buildTransferLabel = (items: ConversionItemDraft[]) => {
  const hasImage = items.some((item) => item.kind === "image");
  const hasVideo = items.some((item) => item.kind === "video");
  if (hasImage && hasVideo) return "Convert media";
  if (hasVideo) return "Convert videos";
  return "Convert images";
};

// Batch per-item run-state updates so large conversion sets do not clone
// status/message maps on every single item transition.
const RUN_STATE_FLUSH_INTERVAL_MS = 80;

type ConversionRunAccumulator = {
  transferJobId: string;
  total: number;
  processed: number;
  completed: number;
  failed: number;
  message: string | null;
  itemStatusByPath: Record<string, ConversionItemRunStatus>;
  itemMessageByPath: Record<string, string | null>;
  flushHandle: ReturnType<typeof setTimeout> | null;
};

export const useConversionController = ({
  deleteEntries,
  refreshEntries,
  ffmpegPath,
}: UseConversionControllerOptions) => {
  const [conversionModalState, setConversionModalState] = useState<ConversionModalState>({
    open: false,
    request: null,
    uiDraft: null,
    run: null,
  });
  const conversionStateRef = useRef(conversionModalState);
  const runAccumulatorRef = useRef<ConversionRunAccumulator | null>(null);

  const startTransferJob = useTransferStore((state) => state.startJob);
  const updateTransferJob = useTransferStore((state) => state.updateProgress);
  const updateTransferLabel = useTransferStore((state) => state.updateLabel);
  const completeTransferJob = useTransferStore((state) => state.completeJob);
  const failTransferJob = useTransferStore((state) => state.failJob);

  useEffect(() => {
    conversionStateRef.current = conversionModalState;
  }, [conversionModalState]);

  useEffect(() => {
    return () => {
      const runAccumulator = runAccumulatorRef.current;
      if (!runAccumulator?.flushHandle) return;
      clearTimeout(runAccumulator.flushHandle);
      runAccumulator.flushHandle = null;
    };
  }, []);

  const openConversionModal = useCallback((request: ConversionModalRequest) => {
    setConversionModalState((prev) => {
      // Keep the active run visible if users reopen while a conversion is still running.
      if (prev.run?.phase === "running" && prev.request && prev.uiDraft) {
        return {
          ...prev,
          open: true,
        };
      }
      return {
        open: true,
        request,
        uiDraft: buildConversionModalDraft(request),
        run: buildConversionRunState(request),
      };
    });
  }, []);

  const closeConversionModal = useCallback(() => {
    setConversionModalState((prev) => {
      if (!prev.request || !prev.run || prev.run.phase === "running") {
        return {
          ...prev,
          open: false,
        };
      }
      // When users reopen after a finished/failed run, start from a clean status view.
      return {
        ...prev,
        open: false,
        run: buildConversionRunState(prev.request),
      };
    });
  }, []);

  const handleConversionDraftChange = useCallback((draft: ConversionModalDraft) => {
    setConversionModalState((prev) => ({
      ...prev,
      uiDraft: draft,
      run:
        prev.request && prev.run?.phase !== "running"
          ? buildConversionRunState(prev.request)
          : prev.run,
    }));
  }, []);

  const startConversionRun = useCallback(
    (request: ConversionModalRequest, draft: ConversionModalDraft, keepModalOpen: boolean) => {
      const currentRun = conversionStateRef.current.run;
      if (currentRun?.phase === "running") return;

      const setRunFailure = (message: string) => {
        setConversionModalState({
          open: keepModalOpen,
          request,
          uiDraft: draft,
          run: buildConversionRunState(request, {
            phase: "failed",
            message,
          }),
        });
      };

      const conversionItems = request.items.filter(
        (item) => item.kind === "image" || item.kind === "video",
      );
      if (conversionItems.length === 0) {
        setRunFailure("No convertible files selected.");
        return;
      }

      if (draft.outputMode === "create-new" && draft.suffix.trim().length === 0) {
        setRunFailure("Suffix is required when using Create new output mode.");
        return;
      }

      const imageQuality = Math.min(100, Math.max(1, Math.round(draft.imageOptions.quality)));
      const ruleMap = new Map(draft.rules.map((rule) => [rule.kind, rule]));
      const explicitFfmpegPath = ffmpegPath.trim();

      const targetByPath = new Map<string, ItemConversionTarget>();
      for (const item of conversionItems) {
        const ruleFormat = ruleMap.get(item.kind)?.targetFormat ?? null;
        const selectedFormat = item.override?.targetFormat ?? ruleFormat ?? "";
        if (item.kind === "image") {
          const imageSpec = resolveImageTargetSpec(selectedFormat);
          if (!imageSpec) {
            setRunFailure(`Missing target format for ${item.name}.`);
            return;
          }
          targetByPath.set(item.path, {
            kind: "image",
            extension: imageSpec.extension,
            format: imageSpec.format,
            quality: imageSpec.supportsQuality ? imageQuality : null,
          });
          continue;
        }

        const videoSpec = resolveVideoTargetSpec(selectedFormat);
        if (!videoSpec) {
          setRunFailure(`Missing target format for ${item.name}.`);
          return;
        }
        targetByPath.set(item.path, {
          kind: "video",
          extension: videoSpec.extension,
          options: {
            format: videoSpec.format,
            encoder: draft.videoOptions.encoder,
            speed: draft.videoOptions.speed,
            quality: draft.videoOptions.quality,
            audioEnabled: draft.videoOptions.audioEnabled,
            ffmpegPath: explicitFfmpegPath.length > 0 ? explicitFfmpegPath : null,
          },
        });
      }

      const transferLabel = buildTransferLabel(conversionItems);
      const transferJob = startTransferJob({
        label: transferLabel,
        total: conversionItems.length,
        items: conversionItems.map((item) => item.path),
      });

      const initialRunState = buildConversionRunState(request, {
        phase: "running",
        total: conversionItems.length,
        message: `Converting 0/${conversionItems.length} items...`,
        transferJobId: transferJob.id,
      });
      setConversionModalState({
        open: keepModalOpen,
        request,
        uiDraft: draft,
        run: initialRunState,
      });

      const previousAccumulator = runAccumulatorRef.current;
      if (previousAccumulator?.flushHandle) {
        clearTimeout(previousAccumulator.flushHandle);
        previousAccumulator.flushHandle = null;
      }
      const runAccumulator: ConversionRunAccumulator = {
        transferJobId: transferJob.id,
        total: conversionItems.length,
        processed: 0,
        completed: 0,
        failed: 0,
        message: initialRunState.message,
        itemStatusByPath: { ...initialRunState.itemStatusByPath },
        itemMessageByPath: { ...initialRunState.itemMessageByPath },
        flushHandle: null,
      };
      runAccumulatorRef.current = runAccumulator;

      const applyRunSnapshot = () => {
        setConversionModalState((prev) => {
          if (!prev.run || prev.run.transferJobId !== runAccumulator.transferJobId) {
            return prev;
          }
          return {
            ...prev,
            run: {
              ...prev.run,
              processed: runAccumulator.processed,
              completed: runAccumulator.completed,
              failed: runAccumulator.failed,
              itemStatusByPath: { ...runAccumulator.itemStatusByPath },
              itemMessageByPath: { ...runAccumulator.itemMessageByPath },
              message: runAccumulator.message,
            },
          };
        });
      };

      const flushRunSnapshot = () => {
        if (runAccumulator.flushHandle) {
          clearTimeout(runAccumulator.flushHandle);
          runAccumulator.flushHandle = null;
        }
        applyRunSnapshot();
      };

      const scheduleRunSnapshot = () => {
        if (runAccumulator.flushHandle) return;
        runAccumulator.flushHandle = setTimeout(() => {
          runAccumulator.flushHandle = null;
          applyRunSnapshot();
        }, RUN_STATE_FLUSH_INTERVAL_MS);
      };

      void (async () => {
        const seenDestinations = new Set<string>();
        const existsCache = new Map<string, boolean>();
        try {
          const pathExists = async (path: string) => {
            const key = toPathKey(path);
            if (existsCache.has(key)) {
              return Boolean(existsCache.get(key));
            }
            const [meta] = await statEntries([path]);
            const exists = Boolean(meta && (meta.size != null || meta.modified != null));
            existsCache.set(key, exists);
            return exists;
          };

          const resolveUniqueDestination = async (
            parent: string,
            stem: string,
            extension: string,
          ) => {
            let index = 0;
            while (index < 10_000) {
              const suffix = index === 0 ? "" : ` (${index})`;
              const candidate = joinPath(parent, `${stem}${suffix}.${extension}`);
              const key = toPathKey(candidate);
              if (seenDestinations.has(key)) {
                index += 1;
                continue;
              }
              if (await pathExists(candidate)) {
                index += 1;
                continue;
              }
              seenDestinations.add(key);
              existsCache.set(key, true);
              return candidate;
            }
            throw new Error("Unable to find a unique destination path.");
          };

          for (const item of conversionItems) {
            const target = targetByPath.get(item.path);
            if (!target) {
              runAccumulator.processed += 1;
              runAccumulator.failed += 1;
              runAccumulator.itemStatusByPath[item.path] = "failed";
              runAccumulator.itemMessageByPath[item.path] = "Missing target format.";
              runAccumulator.message = `Converted ${runAccumulator.processed}/${runAccumulator.total} items...`;
              updateTransferJob(transferJob.id, {
                processed: runAccumulator.processed,
                total: runAccumulator.total,
                currentPath: item.path,
              });
              scheduleRunSnapshot();
              continue;
            }

            runAccumulator.itemStatusByPath[item.path] = "running";
            runAccumulator.itemMessageByPath[item.path] = null;
            runAccumulator.message = `Converting ${runAccumulator.processed + 1}/${runAccumulator.total}: ${item.name}`;
            scheduleRunSnapshot();

            try {
              const parent = getParentPath(item.path);
              if (!parent) {
                throw new Error("Couldn't resolve source folder.");
              }
              const baseName = splitNameExtension(item.name).base || item.name;
              let destination = "";
              if (draft.outputMode === "create-new") {
                const stem = `${baseName}${draft.suffix}`;
                destination = await resolveUniqueDestination(parent, stem, target.extension);
              } else {
                destination = joinPath(parent, `${baseName}.${target.extension}`);
                const destinationKey = toPathKey(destination);
                const sourceKey = toPathKey(item.path);
                if (target.kind === "video" && destinationKey === sourceKey) {
                  throw new Error("Video replace requires a different target format.");
                }
                if (seenDestinations.has(destinationKey) && destinationKey !== sourceKey) {
                  throw new Error("Destination conflicts with another selected item.");
                }
                seenDestinations.add(destinationKey);
              }

              if (target.kind === "image") {
                await convertImage(item.path, destination, {
                  format: target.format,
                  quality: target.quality,
                  overwrite: draft.outputMode === "replace",
                });
              } else {
                await convertVideo(item.path, destination, {
                  ...target.options,
                  overwrite: draft.outputMode === "replace",
                });
              }

              if (draft.outputMode === "replace" && toPathKey(item.path) !== toPathKey(destination)) {
                const deleteReport = await deleteEntries([item.path]);
                if (!deleteReport || deleteReport.deleted < 1) {
                  throw new Error("Converted output created, but original file could not be removed.");
                }
              }

              runAccumulator.processed += 1;
              runAccumulator.completed += 1;
              runAccumulator.itemStatusByPath[item.path] = "completed";
              runAccumulator.itemMessageByPath[item.path] = `Saved to ${destination}`;
              runAccumulator.message = `Converted ${runAccumulator.processed}/${runAccumulator.total} items...`;
              updateTransferJob(transferJob.id, {
                processed: runAccumulator.processed,
                total: runAccumulator.total,
                currentPath: destination,
              });
              scheduleRunSnapshot();
            } catch (error) {
              runAccumulator.processed += 1;
              runAccumulator.failed += 1;
              runAccumulator.itemStatusByPath[item.path] = "failed";
              updateTransferJob(transferJob.id, {
                processed: runAccumulator.processed,
                total: runAccumulator.total,
                currentPath: item.path,
              });
              const message = toMessage(error, "Conversion failed.");
              runAccumulator.itemMessageByPath[item.path] = message;
              runAccumulator.message = `Converted ${runAccumulator.processed}/${runAccumulator.total} items...`;
              scheduleRunSnapshot();
            }
          }

          flushRunSnapshot();
          updateTransferLabel(transferJob.id, transferLabel);
          if (runAccumulator.failed > 0) {
            failTransferJob(transferJob.id, {
              total: runAccumulator.total,
              processed: runAccumulator.processed,
              copied: runAccumulator.completed,
              failures: runAccumulator.failed,
            });
          } else {
            completeTransferJob(transferJob.id, {
              copied: runAccumulator.completed,
              failures: 0,
            });
          }
          if (runAccumulator.completed > 0) {
            await refreshEntries();
          }
          setConversionModalState((prev) => {
            if (!prev.run || prev.run.transferJobId !== runAccumulator.transferJobId) {
              return prev;
            }
            const phase = runAccumulator.failed > 0 ? "failed" : "completed";
            const message =
              runAccumulator.failed > 0
                ? `Completed with issues: ${runAccumulator.completed} succeeded, ${runAccumulator.failed} failed.`
                : `Completed: ${runAccumulator.completed} item${runAccumulator.completed === 1 ? "" : "s"} converted.`;
            return {
              ...prev,
              run: {
                ...prev.run,
                phase,
                processed: runAccumulator.processed,
                completed: runAccumulator.completed,
                failed: runAccumulator.failed,
                itemStatusByPath: { ...runAccumulator.itemStatusByPath },
                itemMessageByPath: { ...runAccumulator.itemMessageByPath },
                message,
              },
            };
          });
        } finally {
          if (runAccumulator.flushHandle) {
            clearTimeout(runAccumulator.flushHandle);
            runAccumulator.flushHandle = null;
          }
          if (runAccumulatorRef.current?.transferJobId === runAccumulator.transferJobId) {
            runAccumulatorRef.current = null;
          }
        }
      })();
    },
    [
      completeTransferJob,
      deleteEntries,
      failTransferJob,
      ffmpegPath,
      refreshEntries,
      startTransferJob,
      updateTransferJob,
      updateTransferLabel,
    ],
  );

  const handleStartConversion = useCallback(() => {
    const snapshot = conversionStateRef.current;
    const request = snapshot.request;
    const draft = snapshot.uiDraft;
    if (!request || !draft) return;
    startConversionRun(request, draft, true);
  }, [startConversionRun]);

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
      startConversionRun(quickRequest, quickDraft, false);
    },
    [startConversionRun],
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
