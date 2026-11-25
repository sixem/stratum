// Read the bundled text only when the disclosure is opened, including offline.
import { useEffect, useState } from "react";
import noticesUrl from "@/assets/THIRD-PARTY-NOTICES.txt?url";

function NoticeText() {
  const [text, setText] = useState("Loading notices…");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(noticesUrl, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const content = await response.text();
        if (!controller.signal.aborted) setText(content);
      } catch {
        if (!controller.signal.aborted) setText("Couldn’t read the bundled notices. Close and reopen to retry.");
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  return <pre tabIndex={0} aria-label="Third-party notices">{text}</pre>;
}

export function ThirdPartyNotices() {
  const [open, setOpen] = useState(false);
  return (
    <details className="about-notices" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Third-party notices</summary>
      {open && <NoticeText />}
    </details>
  );
}
