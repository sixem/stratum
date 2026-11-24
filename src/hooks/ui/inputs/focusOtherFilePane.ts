// Move focus through the usual pane focus handlers so the active pane follows it.
export function focusOtherFilePane(pane: "main" | "bottom") {
  const otherPane = pane === "main" ? "bottom" : "main";
  const view = document.querySelector<HTMLElement>(`[data-file-pane="${otherPane}"]`);
  if (!view) return false;
  view.focus({ preventScroll: true });
  return view.contains(document.activeElement);
}
