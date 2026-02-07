// Platform detection helpers to keep navigator usage consistent and non-deprecated.

const UNKNOWN_PLATFORM = "Unknown";

type NavigatorWithUaData = Navigator & {
  userAgentData?: { platform?: string };
};

const parseUserAgentPlatform = (userAgent: string) => {
  const normalized = userAgent.toLowerCase();
  if (!normalized) return UNKNOWN_PLATFORM;

  // Check mobile variants first so iOS/Android do not get mis-labeled as desktop OSes.
  if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ipod")) {
    return "iOS";
  }
  if (normalized.includes("android")) return "Android";
  if (normalized.includes("cros")) return "ChromeOS";
  if (normalized.includes("windows")) return "Windows";
  if (normalized.includes("macintosh") || normalized.includes("mac os x")) return "macOS";
  if (normalized.includes("linux")) return "Linux";

  return UNKNOWN_PLATFORM;
};

export const getPlatformLabel = () => {
  if (typeof navigator === "undefined") return UNKNOWN_PLATFORM;
  const typedNavigator = navigator as NavigatorWithUaData;
  const uaDataPlatform = typedNavigator.userAgentData?.platform;
  if (uaDataPlatform) return uaDataPlatform;

  // Fall back to the user agent string to avoid deprecated navigator.platform.
  return parseUserAgentPlatform(typedNavigator.userAgent || "");
};
