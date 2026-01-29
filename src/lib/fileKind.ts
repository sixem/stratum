import {
  ARCHIVE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  EXECUTABLE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_LIKE_EXTENSIONS,
  SECURE_EXTENSIONS,
  SVG_LIKE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "@/constants";

export type FileKind =
  | "secure"
  | "document"
  | "video"
  | "audio"
  | "image"
  | "executable"
  | "archive"
  | "generic";

export const isPdfLikeExtension = (extension: string | null): boolean => {
  if (!extension) return false;
  return PDF_LIKE_EXTENSIONS.has(extension.toLowerCase());
};

export const isSvgLikeExtension = (extension: string | null): boolean => {
  if (!extension) return false;
  return SVG_LIKE_EXTENSIONS.has(extension.toLowerCase());
};

export const getExtension = (name: string): string | null => {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return null;
  }
  return name.slice(lastDot + 1).toLowerCase();
};

export const getFileKind = (name: string): FileKind => {
  const ext = getExtension(name);
  if (!ext) return "generic";
  if (EXECUTABLE_EXTENSIONS.has(ext)) return "executable";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (SECURE_EXTENSIONS.has(ext)) return "secure";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "generic";
};
