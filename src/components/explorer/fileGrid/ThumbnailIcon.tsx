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

  // A refresh can replace a file with a folder at the same path, reusing this card.
  const showAppIcon = !isDir && Boolean(appIconUrl) && appIconsEnabled && !thumbReady;
  const [appIconReady, setAppIconReady] = useState(
    () => Boolean(appIconUrl && readyAppIconUrls.has(appIconUrl)),
  );

  useEffect(() => {
    if (!appIconUrl) {
      setAppIconReady(false);
      return;
    }
    setAppIconReady(readyAppIconUrls.has(appIconUrl));
  }, [appIconUrl]);

  // Keep fallback visible until either app icon or thumbnail has decoded for this card.
  const showFallback = !thumbReady && (!showAppIcon || !appIconReady);

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
      {showAppIcon ? (
        <img
          className="thumb-app-icon"
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-ready={appIconReady ? "true" : "false"}
          onLoad={(event) => {
            if (appIconUrl) {
              markAppIconReady(appIconUrl);
            }
            setAppIconReady(true);
            event.currentTarget.dataset.ready = "true";
          }}
          onError={(event) => {
            if (appIconUrl) readyAppIconUrls.delete(appIconUrl);
            setAppIconReady(false);
            event.currentTarget.dataset.ready = "false";
          }}
        />
      ) : null}
      {thumbUrl ? (
        <ThumbnailPreview src={thumbUrl} onReadyChange={setThumbReady} />
      ) : null}
    </>
  );
};
