// Resolve modal draft state into concrete backend conversion job items.
// Keeping this separate makes the controller about submission flow, not path math.
import { statEntries } from "@/api";
import { getParentPath, joinPath, splitNameExtension } from "@/lib";
import type {
  ConversionItemDraft,
  ConversionJobItem,
  ConversionModalDraft,
  ConversionModalRequest,
  ImageTargetFormat,
  VideoConvertOptions,
} from "@/types";
import { resolveImageTargetSpec, resolveVideoTargetSpec, toPathKey } from "./conversionDrafts";

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
      options: Omit<VideoConvertOptions, "overwrite" | "progress">;
    };

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
  request: ConversionModalRequest;
  draft: ConversionModalDraft;
  ffmpegPath: string;
};

export const prepareConversionJob = async ({
  request,
  draft,
  ffmpegPath,
}: PrepareConversionJobOptions): Promise<PreparedConversionJob> => {
  const conversionItems = request.items.filter(
    (item) => item.kind === "image" || item.kind === "video",
  );
  if (conversionItems.length === 0) {
    throw new Error("No convertible files selected.");
  }

  if (draft.outputMode === "create-new" && draft.suffix.trim().length === 0) {
    throw new Error("Suffix is required when using Create new output mode.");
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
        throw new Error(`Missing target format for ${item.name}.`);
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
      throw new Error(`Missing target format for ${item.name}.`);
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

  const seenDestinations = new Set<string>();
  const existsCache = new Map<string, boolean>();
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

  // Create-new mode needs deterministic de-duplication across both existing files
  // and other items in the same conversion batch.
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
      if (seenDestinations.has(key) || (await pathExists(candidate))) {
        index += 1;
        continue;
      }
      seenDestinations.add(key);
      existsCache.set(key, true);
      return candidate;
    }
    throw new Error("Unable to find a unique destination path.");
  };

  const items: ConversionJobItem[] = [];
  for (const item of conversionItems) {
    const target = targetByPath.get(item.path);
    if (!target) {
      throw new Error(`Missing target format for ${item.name}.`);
    }

    const parent = getParentPath(item.path);
    if (!parent) {
      throw new Error(`Couldn't resolve the source folder for ${item.name}.`);
    }
    const baseName = splitNameExtension(item.name).base || item.name;
    let destinationPath = "";
    if (draft.outputMode === "create-new") {
      const stem = `${baseName}${draft.suffix}`;
      destinationPath = await resolveUniqueDestination(parent, stem, target.extension);
    } else {
      destinationPath = joinPath(parent, `${baseName}.${target.extension}`);
      const destinationKey = toPathKey(destinationPath);
      const sourceKey = toPathKey(item.path);
      if (target.kind === "video" && destinationKey === sourceKey) {
        throw new Error("Video replace requires a different target format.");
      }
      if (seenDestinations.has(destinationKey) && destinationKey !== sourceKey) {
        throw new Error("Destination conflicts with another selected item.");
      }
      seenDestinations.add(destinationKey);
    }

    const deleteSourceAfterSuccess =
      draft.outputMode === "replace" && toPathKey(item.path) !== toPathKey(destinationPath);

    if (target.kind === "image") {
      items.push({
        kind: "image",
        sourcePath: item.path,
        destinationPath,
        deleteSourceAfterSuccess,
        options: {
          format: target.format,
          quality: target.quality,
          overwrite: draft.outputMode === "replace",
        },
      });
      continue;
    }

    items.push({
      kind: "video",
      sourcePath: item.path,
      destinationPath,
      deleteSourceAfterSuccess,
      options: {
        ...target.options,
        overwrite: draft.outputMode === "replace",
      },
    });
  }

  return {
    label: buildTransferLabel(conversionItems),
    items,
    sourcePaths: conversionItems.map((item) => item.path),
  };
};
