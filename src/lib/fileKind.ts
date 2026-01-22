export type FileKind =
  | "secure"
  | "document"
  | "video"
  | "audio"
  | "image"
  | "executable"
  | "archive"
  | "generic";

const DOCUMENT_EXTENSIONS = new Set([
  "adoc",
  "asciidoc",
  "cfg",
  "conf",
  "config",
  "doc",
  "docx",
  "odt",
  "rtf",
  "txt",
  "md",
  "markdown",
  "mdx",
  "rst",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "ini",
  "properties",
  "env",
  "log",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "hh",
  "cs",
  "java",
  "kt",
  "kts",
  "swift",
  "py",
  "rb",
  "php",
  "go",
  "rs",
  "sql",
  "gql",
  "graphql",
  "pages",
  "numbers",
  "key",
  "epub",
]);

const SECURE_EXTENSIONS = new Set([
  "pem",
  "key",
  "p8",
  "p12",
  "pfx",
  "p7b",
  "p7c",
  "p7s",
  "cer",
  "crt",
  "der",
  "csr",
  "ppk",
  "gpg",
  "pgp",
  "jks",
  "keystore",
  "kdb",
  "kdbx",
]);

const PDF_LIKE_EXTENSIONS = new Set(["pdf"]);
// Vector formats that should use the SVG-style icon in the grid.
const SVG_LIKE_EXTENSIONS = new Set(["svg", "svgz"]);

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "zipx",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "zst",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "mpg",
  "mpeg",
  "wmv",
  "flv",
  "3gp",
  "ogv",
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "ico",
  "svg",
  "svgz",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "flac",
  "aac",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aiff",
  "aif",
  "alac",
]);

const EXECUTABLE_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "ps1",
  "psm1",
  "vbs",
  "vbe",
  "sh",
  "bash",
  "zsh",
  "fish",
  "app",
  "appimage",
  "run",
  "bin",
]);

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
