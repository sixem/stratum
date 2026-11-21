// Shared file glyphs for the thumbnail grid and indexed search.
// Tabler Icons v3.34.1 outlines and the supplied Lucide file glyphs.
// https://github.com/tabler/tabler-icons/tree/v3.34.1/icons/outline
import { CODE_EXTENSIONS, CONFIG_EXTENSIONS, SCRIPT_EXTENSIONS } from "@/constants/fileKinds";
import { isPdfLikeExtension, isSvgLikeExtension } from "@/lib/fileKind";
import type { FileKind } from "@/lib/fileKind";
import type { IconProps } from "./types";

const fileGlyphs = {
  directory: [
    "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2",
  ],
  generic: [
    "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
    "M9 9.5a3 2.5 0 0 1 6 0c0 2-2 2-3 3.5",
    "M12 17h.01",
  ],
  document: [
    "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
    "M14 2v5a1 1 0 0 0 1 1h5",
    "M10 9H8",
    "M16 13H8",
    "M16 17H8",
  ],
  code: [
    "M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35",
    "M14 2v5a1 1 0 0 0 1 1h5",
    "m5 16-3 3 3 3",
    "m9 22 3-3-3-3",
  ],
  config: [
    "M14 22h4a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6",
    "M14 2v5a1 1 0 0 0 1 1h5",
    "M5 14a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1 1 1 0 0 1 1 1v2a1 1 0 0 0 1 1",
    "M9 22a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1",
  ],
  image: [
    "M15 8h.01",
    "M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z",
    "M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5",
    "M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3",
  ],
  video: [
    "M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z",
    "M8 4l0 16",
    "M16 4l0 16",
    "M4 8l4 0",
    "M4 16l4 0",
    "M4 12l16 0",
    "M16 8l4 0",
    "M16 16l4 0",
  ],
  audio: [
    "M11.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.35",
    "M14 2v5a1 1 0 0 0 1 1h5",
    "M8 20v-7l3 1.474",
    "M4 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  ],
  waveform: [
    "M4 11.55V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-1.95",
    "M14 2v5a1 1 0 0 0 1 1h5",
    "M12 15a5 5 0 0 1 0 6",
    "M8 14.502a.5.5 0 0 0-.826-.381l-1.893 1.631a1 1 0 0 1-.651.243H3.5a.5.5 0 0 0-.5.501v3.006a.5.5 0 0 0 .5.501h1.129a1 1 0 0 1 .652.243l1.893 1.633a.5.5 0 0 0 .826-.38z",
  ],
  archive: [
    "M6 20.735a2 2 0 0 1 -1 -1.735v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-1",
    "M11 17a2 2 0 0 1 2 2v2a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-2a2 2 0 0 1 2 -2z",
    "M11 5l-1 0",
    "M13 7l-1 0",
    "M11 9l-1 0",
    "M13 11l-1 0",
    "M11 13l-1 0",
    "M13 15l-1 0",
  ],
  executable: [
    "M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M12 10.5v1.5",
    "M12 16v1.5",
    "M15.031 12.25l-1.299 .75",
    "M10.268 15l-1.3 .75",
    "M15 15.803l-1.285 -.773",
    "M10.285 12.97l-1.285 -.773",
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z",
  ],
  secure: [
    "M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z",
    "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
    "M8 11v-4a4 4 0 1 1 8 0v4",
  ],
  spreadsheet: [
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z",
    "M8 11h8v7h-8z",
    "M8 15h8",
    "M11 11v7",
  ],
  pdf: [
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4",
    "M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6",
    "M17 18h2",
    "M20 15h-3v6",
    "M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z",
  ],
  svg: [
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4",
    "M4 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75",
    "M10 15l2 6l2 -6",
    "M20 15h-1a2 2 0 0 0 -2 2v2a2 2 0 0 0 2 2h1v-3",
  ],
} satisfies Record<FileKind | "directory" | "pdf" | "spreadsheet" | "svg" | "code" | "config" | "waveform", string[]>;

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
  if (isPdfLikeExtension(extension)) return "pdf";
  if (isSvgLikeExtension(extension)) return "svg";
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {fileGlyphs[kind].map(d => <path key={d} d={d} />)}
    </svg>
  );
};
