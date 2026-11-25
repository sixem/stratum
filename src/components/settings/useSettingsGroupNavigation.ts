// Build section links from the groups rendered in the active settings category.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type Group = { element: HTMLElement; id: string; label: string };

const EMPTY_GROUPS: Group[] = [];
const EDGE_TOLERANCE = 2;

export function useSettingsGroupNavigation(contentRef: RefObject<HTMLDivElement | null>, categoryId: string | null) {
  const [groups, setGroups] = useState(EMPTY_GROUPS);
  const [currentGroupId, setCurrentGroupId] = useState<string>();
  const jumpPosition = useRef<number | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    jumpPosition.current = null;
    const targets = categoryId && content ? Array.from(
      content.querySelectorAll<HTMLElement>("[data-settings-group]"),
      element => ({ element, id: element.id, label: element.dataset.settingsGroup ?? "" }),
    ) : EMPTY_GROUPS;

    if (!content || targets.length < 2) {
      setGroups(EMPTY_GROUPS);
      setCurrentGroupId(undefined);
      return;
    }
    setGroups(targets);

    let frame: number | null = null;
    const updateCurrentGroup = () => {
      const { scrollTop, scrollHeight, clientHeight } = content;
      // Keep the clicked group highlighted if its heading couldn't reach the top.
      if (jumpPosition.current === scrollTop) return;
      jumpPosition.current = null;
      const scrollRange = scrollHeight - clientHeight;
      if (scrollRange > EDGE_TOLERANCE && scrollTop >= scrollRange - EDGE_TOLERANCE) {
        setCurrentGroupId(targets[targets.length - 1].id);
        return;
      }
      const top = content.getBoundingClientRect().top + EDGE_TOLERANCE;
      let current = targets[0];
      for (const target of targets) {
        if (target.element.getBoundingClientRect().top > top) break;
        current = target;
      }
      setCurrentGroupId(current.id);
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateCurrentGroup();
      });
    };
    const resize = new ResizeObserver(scheduleUpdate);
    resize.observe(content);
    for (const { element } of targets) resize.observe(element);
    content.addEventListener("scroll", scheduleUpdate, { passive: true });
    updateCurrentGroup();

    return () => {
      content.removeEventListener("scroll", scheduleUpdate);
      resize.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [categoryId, contentRef]);

  const jumpToGroup = useCallback((id: string) => {
    const content = contentRef.current;
    const group = groups.find(group => group.id === id);
    if (!content || !group) return;
    content.scrollTop += group.element.getBoundingClientRect().top - content.getBoundingClientRect().top;
    jumpPosition.current = content.scrollTop;
    setCurrentGroupId(id);
  }, [contentRef, groups]);

  return { groups, currentGroupId, jumpToGroup };
}
