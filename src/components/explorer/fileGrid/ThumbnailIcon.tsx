// Thumbnail icon selection with optional preview/app icon fallbacks.
import { useEffect, useState } from "react";
import { FileTypeIcon } from "@/components/icons/fileIcons";
import type { ThumbnailIconProps } from "./gridCard.types";
import { isThumbPreviewReadyCached, ThumbnailPreview } from "./ThumbnailPreview";

const APP_ICON_READY_CACHE_LIMIT = 3000;
const readyAppIconUrls = new Set<string>();

const markAppIconReady = (url: string) => {
  if (!url) return;
  if (readyAppIconUrls.has(url)) {
    return;
  }
  readyAppIconUrls.add(url);
  while (readyAppIconUrls.size > APP_ICON_READY_CACHE_LIMIT) {
    const oldest = readyAppIconUrls.values().next().value as string | undefined;
    if (!oldest) break;
    readyAppIconUrls.delete(oldest);
  }
};

export const ThumbnailIcon = ({
  isDir,
  fileKind,
  extension,
  thumbUrl,
  appIconUrl,
  executableIconUrl,
  appIconsEnabled = false,
}: ThumbnailIconProps) => {
  const [thumbReady, setThumbReady] = useState(
    () => Boolean(thumbUrl && isThumbPreviewReadyCached(thumbUrl)),
  );

  useEffect(() => {
    if (!thumbUrl) {
      setThumbReady(false);
      return;
    }
    setThumbReady(isThumbPreviewReadyCached(thumbUrl));
  }, [thumbUrl]);

  const [failedExecutableIcon, setFailedExecutableIcon] = useState<string>();
  const [loadedAppIcon, setLoadedAppIcon] = useState<string>();
  const specificIcon = executableIconUrl !== failedExecutableIcon ? executableIconUrl : undefined;
  // A refresh can replace a file with a folder at the same path, reusing this card.
  const iconUrl = !isDir && appIconsEnabled && !thumbReady ? specificIcon ?? appIconUrl : undefined;
  const appIconReady = Boolean(iconUrl && (loadedAppIcon === iconUrl || readyAppIconUrls.has(iconUrl)));

  // Keep fallback visible until either app icon or thumbnail has decoded for this card.
  const showFallback = !thumbReady && !appIconReady;

  return (
    <>
      {showFallback ? (
        <FileTypeIcon
          className={isDir ? "thumb-svg is-dir" : "thumb-svg"}
          isDir={isDir}
          fileKind={fileKind}
          extension={extension}
        />
      ) : null}
      {iconUrl ? (
        <img
          key={iconUrl}
          className="thumb-app-icon"
          src={iconUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-ready={appIconReady ? "true" : "false"}
          onLoad={() => {
            markAppIconReady(iconUrl);
            setLoadedAppIcon(iconUrl);
          }}
          onError={() => {
            readyAppIconUrls.delete(iconUrl);
            setLoadedAppIcon(undefined);
            if (specificIcon) setFailedExecutableIcon(iconUrl);
          }}
        />
      ) : null}
      {thumbUrl ? (
        <ThumbnailPreview src={thumbUrl} onReadyChange={setThumbReady} />
      ) : null}
    </>
  );
};
