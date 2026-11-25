// Move focus through the usual pane focus handlers so the active pane follows it.
export function focusOtherFilePane(pane: "main" | "bottom") {
  const otherPane = pane === "main" ? "bottom" : "main";
  const view = document.querySelector<HTMLElement>(`[data-file-pane="${otherPane}"]`);
  if (!view) return false;
  // A standalone terminal is the primary surface in its pane.
  const target = view.querySelector<HTMLElement>(":scope > [data-terminal]") ?? view;
  target.focus({ preventScroll: true });
  return view.contains(document.activeElement);
}
