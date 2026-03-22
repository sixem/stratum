// Shared types for entry context-menu builders.

import type { OpenWithHandler } from "@/types";
import type {
  ConversionMediaKind,
  ConversionModalRequest,
} from "@/types";

export type ConvertibleSelectionKind = ConversionMediaKind;

export type EntryMenuOpenWithState = {
  status: "idle" | "loading" | "ready" | "error";
  handlers: OpenWithHandler[];
  targetPath: string | null;
};

export type EntryMenuSelectionSummary = {
  quickConvertKind: ConvertibleSelectionKind | null;
  canOpenConvertModal: boolean;
  sharedExtension: string | null;
  conversionRequest: ConversionModalRequest | null;
  hasVideo: boolean;
  hasMultiplePropertyTypes: boolean;
};
