// Thumbnail icon selection with optional preview/app icon fallbacks.
import { isPdfLikeExtension, isSvgLikeExtension } from "@/lib";
import type { FileKind } from "@/lib";
import {
  ArchiveIcon,
  AudioIcon,
  ExecutableFileIcon,
  FallbackFileIcon,
  FolderIcon,
  ImageIcon,
  PdfIcon,
  SecureFileIcon,
  SvgIcon,
  TextFileIcon,
  VideoIcon,
} from "../icons";
import type { ThumbnailIconProps } from "./gridCard.types";
import { ThumbnailPreview } from "./ThumbnailPreview";

const resolveFallbackIcon = (fileKind: FileKind, extension: string | null) => {
  if (isSvgLikeExtension(extension)) {
    return SvgIcon;
  }
  switch (fileKind) {
    case "document":
      return isPdfLikeExtension(extension) ? PdfIcon : TextFileIcon;
    case "video":
      return VideoIcon;
    case "audio":
      return AudioIcon;
    case "image":
      return ImageIcon;
    case "executable":
      return ExecutableFileIcon;
    case "archive":
      return ArchiveIcon;
    case "secure":
      return SecureFileIcon;
    case "generic":
      return FallbackFileIcon;
  }
};

export const ThumbnailIcon = ({
  isDir,
  fileKind,
  extension,
  thumbUrl,
  appIconUrl,
  appIconsEnabled = false,
}: ThumbnailIconProps) => {
  if (isDir) {
    if (thumbUrl) {
      return <ThumbnailPreview src={thumbUrl} />;
    }
    return <FolderIcon className="thumb-svg is-dir" />;
  }

  const Icon = resolveFallbackIcon(fileKind, extension);
  const showThumbnail = Boolean(thumbUrl);
  const showAppIcon = Boolean(appIconUrl) && appIconsEnabled && !showThumbnail;
  const showFallback = !showThumbnail && !showAppIcon;

  return (
    <>
      {showFallback ? <Icon className="thumb-svg" /> : null}
      {showAppIcon ? (
        <img
          className="thumb-app-icon"
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-ready="false"
          onLoad={(event) => {
            event.currentTarget.dataset.ready = "true";
          }}
          onError={(event) => {
            event.currentTarget.dataset.ready = "false";
          }}
        />
      ) : null}
      {thumbUrl ? <ThumbnailPreview src={thumbUrl} /> : null}
    </>
  );
};
