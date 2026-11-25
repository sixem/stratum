// Anchors occupy the leading segment of each tab strip.
import type { Tab } from "@/types/tabs";

export function firstUnanchoredTabIndex(tabs: readonly Tab[]) {
  const index = tabs.findIndex(tab => !tab.anchored);
  return index < 0 ? tabs.length : index;
}

export function setTabAnchored(tabs: Tab[], id: string, anchored: boolean): Tab[] {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0 || Boolean(tabs[index].anchored) === anchored) return tabs;

  const next = [...tabs];
  const [tab] = next.splice(index, 1);
  // New anchors go after the existing ones. Unanchoring leads the regular tabs.
  next.splice(firstUnanchoredTabIndex(next), 0, { ...tab, anchored: anchored ? true : undefined });
  return next;
}

export function reorderTabs(tabs: Tab[], id: string, toIndex: number): Tab[] {
  const from = tabs.findIndex(tab => tab.id === id);
  if (from < 0) return tabs;
  const boundary = firstUnanchoredTabIndex(tabs);
  const min = tabs[from].anchored ? 0 : boundary;
  const max = tabs[from].anchored ? boundary - 1 : tabs.length - 1;
  // The drop slot was measured with the dragged tab still in the strip.
  const adjusted = toIndex > from ? toIndex - 1 : toIndex;
  const to = Math.min(Math.max(adjusted, min), max);
  if (from === to) return tabs;

  const next = [...tabs];
  const [tab] = next.splice(from, 1);
  next.splice(to, 0, tab);
  return next;
}
