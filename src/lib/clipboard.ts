// Clipboard helpers for sharing file paths with the OS.

const buildClipboardText = (paths: string[]) => paths.join("\n");

const writeClipboardWithFallback = async (text: string) => {
  if (!text) return false;
  const navigatorClipboard = globalThis.navigator?.clipboard;
  if (navigatorClipboard?.writeText) {
    try {
      await navigatorClipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy execCommand copy.
    }
  }
  try {
    if (!globalThis.document) return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.top = "0";
    textarea.style.left = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

export const copyPathsToClipboard = async (paths: string[]) => {
  const text = buildClipboardText(paths);
  return writeClipboardWithFallback(text);
};
