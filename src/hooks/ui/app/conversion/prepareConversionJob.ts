// Resolve modal draft state into concrete backend conversion job items.
// Keeping this separate makes the controller about submission flow, not path math.
import { videoEncodingForTarget } from "../../../../constants/convert.ts";
import { getParentPath } from "../../../../lib/paths.ts";
import { joinPath } from "../../../../lib/dropPaths.ts";
import type {
  ConversionItemDraft,
  ConversionJobItem,
  ConversionModalDraft,
} from "@/types";
import { resolveImageTargetSpec, resolveVideoTargetSpec } from "./conversionDrafts.ts";
import { conversionFileName, invalidConversionSuffix } from "./conversionNames.ts";
import { checkConversionOutputs, type StatOutputPaths } from "./checkConversionOutputs.ts";

export type PreparedConversionJob = {
  label: string;
  items: ConversionJobItem[];
  sourcePaths: string[];
};

const buildTransferLabel = (items: ConversionItemDraft[]) => {
  const hasImage = items.some((item) => item.kind === "image");
  const hasVideo = items.some((item) => item.kind === "video");
  if (hasImage && hasVideo) return "Convert media";
  if (hasVideo) return "Convert videos";
  return "Convert images";
};

type PrepareConversionJobOptions = {
  draft: ConversionModalDraft;
  ffmpegPath: string;
  statEntries: StatOutputPaths;
  signal?: AbortSignal;
};

export const prepareConversionJob = async ({
  draft,
  ffmpegPath,
  statEntries,
  signal,
}: PrepareConversionJobOptions): Promise<PreparedConversionJob> => {
  const conversionItems = draft.items;
  if (conversionItems.length === 0) {
    throw new Error("No convertible files selected.");
  }

  if (draft.outputMode === "create-new" && invalidConversionSuffix(draft.suffix)) {
    throw new Error("Use a filename suffix without Windows path separators or reserved characters.");
  }

  const imageQuality = Math.min(100, Math.max(1, Math.round(draft.imageOptions.quality)));
  const ruleMap = new Map(draft.rules.map((rule) => [rule.kind, rule]));
  const items = conversionItems.map((item): ConversionJobItem => {
    const rule = ruleMap.get(item.kind);
    const selectedFormat = item.override?.targetFormat ?? rule?.targetFormat ?? "";
    const target = item.kind === "image"
      ? resolveImageTargetSpec(selectedFormat)
      : resolveVideoTargetSpec(selectedFormat);
    if (!target) throw new Error(`Missing target format for ${item.name}.`);

    const parent = getParentPath(item.path);
    if (!parent) throw new Error(`Couldn't resolve the source folder for ${item.name}.`);
    const name = conversionFileName(item.name, target.extension, draft.outputMode, draft.suffix);
    const replaceSource = draft.outputMode === "replace" && name === item.name;
    const paths = {
      sourcePath: item.path,
      destinationPath: joinPath(parent, name),
      deleteSourceAfterSuccess: draft.outputMode === "replace" && !replaceSource,
    };
    if ("supportsQuality" in target) {
      return {
        ...paths,
        kind: "image",
        options: {
          format: target.format,
          quality: target.supportsQuality ? imageQuality : null,
          overwrite: replaceSource,
        },
      };
    }
    const { encoder, quality, speed, audioEnabled } = draft.videoOptions;
    return {
      ...paths,
      kind: "video",
      options: {
        format: target.format,
        ...videoEncodingForTarget(target.format, encoder, quality),
        speed, audioEnabled,
        ffmpegPath: ffmpegPath.trim() || null,
        overwrite: replaceSource,
      },
    };
  });

  await checkConversionOutputs(items, draft.outputMode, statEntries, signal);
  return {
    label: buildTransferLabel(conversionItems),
    items,
    sourcePaths: conversionItems.map((item) => item.path),
  };
};
