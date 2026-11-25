// File extension buckets for type detection and search.
import fileKinds from "./fileKinds.json" with { type: "json" };

export const CONFIG_EXTENSIONS = new Set(fileKinds.config);

export const CODE_EXTENSIONS = new Set(fileKinds.code);

export const SCRIPT_EXTENSIONS = new Set(fileKinds.script);

export const DOCUMENT_EXTENSIONS = new Set([...CONFIG_EXTENSIONS, ...CODE_EXTENSIONS, ...fileKinds.document]);

export const SECURE_EXTENSIONS = new Set(fileKinds.secure);

export const PDF_LIKE_EXTENSIONS = new Set(["pdf"]);
// Vector formats that should use the SVG-style icon in the grid.
export const SVG_LIKE_EXTENSIONS = new Set(["svg", "svgz"]);

export const ARCHIVE_EXTENSIONS = new Set(fileKinds.archive);

export const VIDEO_EXTENSIONS = new Set(fileKinds.video);

export const IMAGE_EXTENSIONS = new Set(fileKinds.image);

export const AUDIO_EXTENSIONS = new Set(fileKinds.audio);

export const EXECUTABLE_EXTENSIONS = new Set([...SCRIPT_EXTENSIONS, ...fileKinds.executable]);
