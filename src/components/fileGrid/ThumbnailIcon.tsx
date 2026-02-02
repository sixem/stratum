// Thumbnail icon selection with optional preview/app icon fallbacks.
import { useEffect, useState } from "react";
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
  const [previewReady, setPreviewReady] = useState(false);
  const [appIconReady, setAppIconReady] = useState(false);

  useEffect(() => {
    if (!thumbUrl) {
      setPreviewReady(false);
    }
  }, [thumbUrl]);

  useEffect(() => {
    if (!appIconUrl) {
      setAppIconReady(false);
    }
  }, [appIconUrl]);

  if (isDir) {
    return <FolderIcon className="thumb-svg is-dir" />;
  }

  const Icon = resolveFallbackIcon(fileKind, extension);
  const showThumbnail = Boolean(thumbUrl);
  const showAppIcon = Boolean(appIconUrl) && (!showThumbnail || !previewReady);
  const allowFallback =
    !appIconsEnabled || (!showThumbnail && !showAppIcon && !appIconUrl);
  const showFallback = allowFallback && !previewReady && (!showAppIcon || !appIconReady);

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
          data-ready={appIconReady ? "true" : "false"}
          onLoad={() => setAppIconReady(true)}
          onError={() => setAppIconReady(false)}
        />
      ) : null}
      {thumbUrl ? (
        <ThumbnailPreview src={thumbUrl} onReadyChange={setPreviewReady} />
      ) : null}
    </>
  );
};
