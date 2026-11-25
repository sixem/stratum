// Read and render the bundled notices only while their dialog is open.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { NavArrowIcon } from "@/components/icons";
import noticesUrl from "@/assets/THIRD-PARTY-NOTICES.txt?url";
import { DialogCloseButton } from "./DialogCloseButton";
import { ExternalLink } from "./ExternalLink";

type ThirdPartyNoticesProps = {
  titleId: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onClose: () => void;
};

function linkNoticeText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const { 0: match, index } of text.matchAll(/https?:\/\/[^\s<>"()[\]]+/g)) {
    const url = match.replace(/[.,;:!?]+$/, "");
    // Preserve the written notices while directing older links to their HTTPS destinations.
    const href = url === "http://scripts.sil.org/OFL" ? "https://openfontlicense.org/" : url.replace(/^http:/, "https:");
    parts.push(text.slice(offset, index), <ExternalLink key={index} href={href}>{url}</ExternalLink>);
    offset = index + url.length;
  }
  parts.push(text.slice(offset));
  return parts;
}

export function ThirdPartyNotices({ titleId, viewportRef, onBack, onClose }: ThirdPartyNoticesProps) {
  const [text, setText] = useState<string | null>();
  const [scrollPercent, setScrollPercent] = useState(0);
  const documentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(noticesUrl, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const content = await response.text();
        if (!controller.signal.aborted) setText(content.replace(/^Third-party notices\r?\n\r?\n/, ""));
      } catch {
        if (!controller.signal.aborted) setText(null);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const linkedText = useMemo(() => typeof text === "string" ? linkNoticeText(text) : null, [text]);
  const updateProgress = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scrollRange = viewport.scrollHeight - viewport.clientHeight;
    const ratio = scrollRange > 0 ? viewport.scrollTop / scrollRange : 1;
    setScrollPercent(Math.round(Math.min(1, Math.max(0, ratio)) * 100));
  }, [viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = documentRef.current;
    if (!viewport || !content || !linkedText) return;
    const resize = new ResizeObserver(updateProgress);
    resize.observe(viewport);
    resize.observe(content);
    updateProgress();
    return () => resize.disconnect();
  }, [linkedText, updateProgress, viewportRef]);

  return (
    <>
      <header className="notices-header">
        <h2 id={titleId}>Third-party notices</h2>
        <DialogCloseButton label="Close notices" onClose={onClose} />
      </header>
      <div
        className="notices-scroll"
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label="License text"
        onScroll={linkedText ? updateProgress : undefined}
      >
        {linkedText ? (
          <div className="notices-text" ref={documentRef}>{linkedText}</div>
        ) : (
          <p className="notices-message" role="status">
            {text === null ? "Couldn’t load the bundled notices." : "Loading notices…"}
          </p>
        )}
      </div>
      <footer className="notices-footer">
        <button className="notices-back" type="button" onClick={onBack}>
          <NavArrowIcon /> Back
        </button>
        <div className="notices-progress" aria-hidden={!linkedText || undefined}>
          <progress className="notices-progress-bar" aria-label="Scroll progress" value={scrollPercent} max={100} />
          <span className="tnum" aria-hidden="true">{scrollPercent}%</span>
        </div>
      </footer>
    </>
  );
}
