// Shared file glyphs for the thumbnail grid and indexed search.
// Tabler Icons v3.34.1 outlines and the supplied Lucide file glyphs.
// https://github.com/tabler/tabler-icons/tree/v3.34.1/icons/outline
import { CODE_EXTENSIONS, CONFIG_EXTENSIONS, SCRIPT_EXTENSIONS } from "@/constants/fileKinds";
import { isPdfLikeExtension, isSvgLikeExtension } from "@/lib/fileKind";
import type { FileKind } from "@/lib/fileKind";
import type { IconProps } from "./types";

// The supplied Lucide file icons share this outline and folded corner.
const fileOutline = "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z";
const fileFold = "M14 2v5a1 1 0 0 0 1 1h5";

const fileGlyphs = {
  directory: [
    "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2",
  ],
  generic: [
    fileOutline,
    fileFold,
  ],
  document: [
    fileOutline,
    fileFold,
    "M10 9H8",
    "M16 13H8",
    "M16 17H8",
  ],
  code: [
    "M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35",
    fileFold,
    "m5 16-3 3 3 3",
    "m9 22 3-3-3-3",
  ],
  config: [
    fileOutline,
    fileFold,
    "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1",
    "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1",
  ],
  image: [
    fileOutline,
    fileFold,
    "M10 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4z",
    "m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",
  ],
  video: [
    "M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2",
    fileFold,
    "m10 17.843 3.033-1.755a.64.64 0 0 1 .967.56v4.704a.65.65 0 0 1-.967.56L10 20.157",
    "M4 16h5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z",
  ],
  audio: [
    "M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343",
    fileFold,
    "M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0",
  ],
  waveform: [
    "M4 11.55V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-1.95",
    fileFold,
    "M12 15a5 5 0 0 1 0 6",
    "M8 14.502a.5.5 0 0 0-.826-.381l-1.893 1.631a1 1 0 0 1-.651.243H3.5a.5.5 0 0 0-.5.501v3.006a.5.5 0 0 0 .5.501h1.129a1 1 0 0 1 .652.243l1.893 1.633a.5.5 0 0 0 .826-.38z",
  ],
  archive: [
    "M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5",
    fileFold,
    "M8 12v-1",
    "M8 18v-2",
    "M8 7V6",
    "M8 18a2 2 0 1 0 0 4a2 2 0 0 0 0-4z",
  ],
  executable: [
    "M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2",
    fileFold,
    "M10 16h2v6",
    "M10 22h4",
    "M4 16a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2z",
  ],
  secure: [
    "M4 9.8V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3",
    fileFold,
    "M9 17v-2a2 2 0 0 0-4 0v2",
    "M4 17h6a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
  ],
  spreadsheet: [
    fileOutline,
    fileFold,
    "M8 13h2",
    "M14 13h2",
    "M8 17h2",
    "M14 17h2",
  ],
} satisfies Record<FileKind | "directory" | "spreadsheet" | "code" | "config" | "waveform", string[]>;

const spreadsheetExtensions = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsb", "xlsm", "xlsx"]);
const waveformExtensions = new Set(["aif", "aiff", "wav"]);

type FileTypeIconProps = IconProps & {
  isDir: boolean;
  fileKind: FileKind;
  extension: string | null;
};

const getFileGlyph = ({ isDir, fileKind, extension }: FileTypeIconProps): keyof typeof fileGlyphs => {
  if (isDir) return "directory";
  if (!extension) return fileKind;
  if (isPdfLikeExtension(extension)) return "document";
  if (isSvgLikeExtension(extension)) return "image";
  if (spreadsheetExtensions.has(extension)) return "spreadsheet";
  if (CONFIG_EXTENSIONS.has(extension)) return "config";
  if (CODE_EXTENSIONS.has(extension) || SCRIPT_EXTENSIONS.has(extension)) return "code";
  if (waveformExtensions.has(extension)) return "waveform";
  return fileKind;
};

export const FileTypeIcon = (props: FileTypeIconProps) => {
  const kind = getFileGlyph(props);

  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {fileGlyphs[kind].map(d => <path key={d} d={d} />)}
    </svg>
  );
};
