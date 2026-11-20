// Shared between the output preview and the actual job plan.
import { splitNameExtension } from "../../../../lib/fileName.ts";
import type { ConversionOutputMode } from "@/types";

export function conversionFileName(name: string, extension: string, mode: ConversionOutputMode, suffix: string) {
  const { base, extension: sourceExtension } = splitNameExtension(name);
  if (mode === "replace" && sourceExtension?.toLowerCase() === extension) return name;
  return `${base}${mode === "create-new" ? suffix : ""}.${extension}`;
}

export function invalidConversionSuffix(suffix: string) {
  return /[<>:"/\\|?*\u0000-\u001f]/.test(suffix);
}
