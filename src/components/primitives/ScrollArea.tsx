// Lightweight scroll wrapper that keeps native scrolling but renders a custom overlay thumb.
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

type ScrollbarVariant = "default" | "compact" | "nav" | "overlay";

type ThumbState = {
  size: number;
  offset: number;
  visible: boolean;
};

type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  scrollbarVariant?: ScrollbarVariant;
  thumbMinSize?: number;
};

const DEFAULT_THUMB_STATE: ThumbState = {
  size: 0,
  offset: 0,
  visible: false,
};

const joinClassNames = (...parts: Array<string | false | null | undefined>) => {
  return parts.filter(Boolean).join(" ");
};

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      className,
      viewportClassName,
      contentClassName,
      scrollbarVariant = "default",
      thumbMinSize = 24,
    },
    forwardedRef,
  ) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const thumbSizeRef = useRef(thumbMinSize);
    const dragRef = useRef<{
      pointerId: number;
      startClientY: number;
      startScrollTop: number;
    } | null>(null);
    const [thumb, setThumb] = useState<ThumbState>(DEFAULT_THUMB_STATE);
    const [dragging, setDragging] = useState(false);

    const setViewportRef = useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const updateThumb = useCallback(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const viewportHeight = viewport.clientHeight;
      const contentHeight = viewport.scrollHeight;
      const maxScrollTop = Math.max(0, contentHeight - viewportHeight);

      if (viewportHeight <= 0 || maxScrollTop <= 0) {
        setThumb((current) => (current.visible ? DEFAULT_THUMB_STATE : current));
        return;
      }

      const nextSize = Math.max(
        thumbMinSize,
        Math.round((viewportHeight / contentHeight) * viewportHeight),
      );
      const maxOffset = Math.max(0, viewportHeight - nextSize);
      const nextOffset =
        maxScrollTop > 0
          ? Math.round((viewport.scrollTop / maxScrollTop) * maxOffset)
          : 0;

      thumbSizeRef.current = nextSize;
      setThumb((current) => {
        if (
          current.visible &&
          current.size === nextSize &&
          current.offset === nextOffset
        ) {
          return current;
        }
        return {
          size: nextSize,
          offset: nextOffset,
          visible: true,
        };
      });
    }, [thumbMinSize]);

    const scheduleUpdate = useCallback(() => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateThumb();
      });
    }, [updateThumb]);

    useEffect(() => {
      scheduleUpdate();
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport) return;

      const handleScroll = () => scheduleUpdate();
      viewport.addEventListener("scroll", handleScroll, { passive: true });

      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => scheduleUpdate());
      observer?.observe(viewport);
      if (content) {
        observer?.observe(content);
      }

      return () => {
        viewport.removeEventListener("scroll", handleScroll);
        observer?.disconnect();
        if (rafRef.current != null) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [scheduleUpdate]);

    const handleThumbPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const viewport = viewportRef.current;
        if (!viewport || !thumb.visible) return;

        event.preventDefault();
        event.stopPropagation();

        dragRef.current = {
          pointerId: event.pointerId,
          startClientY: event.clientY,
          startScrollTop: viewport.scrollTop,
        };
        setDragging(true);

        const handlePointerMove = (moveEvent: PointerEvent) => {
          if (!dragRef.current || moveEvent.pointerId !== dragRef.current.pointerId) {
            return;
          }

          const liveViewport = viewportRef.current;
          if (!liveViewport) return;

          const maxScrollTop = Math.max(
            0,
            liveViewport.scrollHeight - liveViewport.clientHeight,
          );
          const maxThumbOffset = Math.max(
            1,
            liveViewport.clientHeight - thumbSizeRef.current,
          );
          const deltaY = moveEvent.clientY - dragRef.current.startClientY;
          const nextScrollTop =
            dragRef.current.startScrollTop + (deltaY * maxScrollTop) / maxThumbOffset;

          liveViewport.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
        };

        const clearDrag = (endEvent?: PointerEvent) => {
          if (
            endEvent &&
            dragRef.current &&
            endEvent.pointerId !== dragRef.current.pointerId
          ) {
            return;
          }
          dragRef.current = null;
          setDragging(false);
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", clearDrag);
          window.removeEventListener("pointercancel", clearDrag);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", clearDrag);
        window.addEventListener("pointercancel", clearDrag);
      },
      [thumb.visible],
    );

    const rootClassName = useMemo(
      () =>
        joinClassNames(
          "scroll-area",
          dragging && "is-dragging",
          className,
        ),
      [className, dragging],
    );

    const viewportClasses = joinClassNames("scroll-area-viewport", viewportClassName);
    const contentClasses = joinClassNames("scroll-area-content", contentClassName);

    return (
      <div className={rootClassName} data-scrollbar={scrollbarVariant}>
        <div className={viewportClasses} ref={setViewportRef}>
          <div className={contentClasses} ref={contentRef}>
            {children}
          </div>
        </div>
        {thumb.visible ? (
          <div
            aria-hidden="true"
            className="scroll-area-thumb"
            onPointerDown={handleThumbPointerDown}
            style={{
              height: `${thumb.size}px`,
              transform: `translateY(${thumb.offset}px)`,
            }}
          />
        ) : null}
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
