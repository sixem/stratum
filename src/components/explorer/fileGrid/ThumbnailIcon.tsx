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

type IconDecode = { url: string; ready: boolean };

const getIconState = (url: string | null | undefined, decoded: IconDecode | undefined) => {
  if (url === undefined) return "pending";
  if (url === null) return "missing";
  if (decoded?.url === url) return decoded.ready ? "ready" : "missing";
  return readyAppIconUrls.has(url) ? "ready" : "pending";
};

const NativeIcon = ({ url, ready, onDecode }: {
  url: string;
  ready: boolean;
  onDecode: (result: IconDecode) => void;
}) => (
  <img
    className="thumb-app-icon"
    src={url}
    alt=""
    aria-hidden="true"
    draggable={false}
    data-ready={ready ? "true" : "false"}
    onLoad={() => {
      markAppIconReady(url);
      onDecode({ url, ready: true });
    }}
    onError={() => {
      readyAppIconUrls.delete(url);
      onDecode({ url, ready: false });
    }}
  />
);

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

  const [embeddedDecode, setEmbeddedDecode] = useState<IconDecode>();
  const [typeDecode, setTypeDecode] = useState<IconDecode>();
  const useNativeIcons = !isDir && appIconsEnabled && Boolean(extension) && !thumbReady;
  const embeddedUrl = useNativeIcons && extension === "exe" ? executableIconUrl : null;
  const typeUrl = useNativeIcons ? appIconUrl : null;
  const embeddedState = getIconState(embeddedUrl, embeddedDecode);
  const typeState = getIconState(typeUrl, typeDecode);

  // Keep the Windows type icon while the preferred EXE image is being decoded.
  // Wait until all native options are exhausted before showing the SVG.
  const showFallback = !thumbReady && embeddedState === "missing" && typeState === "missing";

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
      {typeUrl && typeState !== "missing" && embeddedState !== "ready" ? (
        <NativeIcon key={typeUrl} url={typeUrl} ready={typeState === "ready"} onDecode={setTypeDecode} />
      ) : null}
      {embeddedUrl && embeddedState !== "missing" ? (
        <NativeIcon key={embeddedUrl} url={embeddedUrl} ready={embeddedState === "ready"} onDecode={setEmbeddedDecode} />
      ) : null}
      {thumbUrl ? (
        <ThumbnailPreview src={thumbUrl} onReadyChange={setThumbReady} />
      ) : null}
    </>
  );
};
