// Decorative file-view previews share the same shell and inherit the chosen colors.
import type { ViewMode } from "@/types";

export const WelcomeViewPreview = ({ mode }: { mode: ViewMode }) => (
  <svg
    className="welcome-view-preview"
    viewBox="0 0 256 116"
    aria-hidden="true"
    focusable="false"
  >
    <path fill="var(--welcome-preview-canvas)" d="M0 0h256v116H0z" />
    <path fill="var(--welcome-preview-sidebar)" d="M0 16h70v100H0z" />
    <path fill="var(--welcome-preview-toolbar)" d="M0 0h256v16H0z" />
    <path fill="none" stroke="var(--welcome-preview-line)" d="M0 16h256M70 16v100" />
    <path
      fill="none"
      stroke="var(--welcome-preview-muted)"
      strokeWidth="2.5"
      strokeLinecap="round"
      opacity=".72"
      d="M8 8h.1m5 0h.1m5 0h.1M10 28h33M10 49h33M10 60h27"
    />
    <path fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" d="M10 38h33" />
    <rect x="82" y="22" width="103" height="4" rx="1" fill="var(--welcome-preview-line)" />
    {mode === "list" ? (
      <>
        <rect
          x="81" y="39" width="166" height="11" rx="2"
          fill="var(--welcome-preview-highlight)"
          stroke="var(--accent)"
        />
        <path fill="var(--welcome-preview-muted)" d="M86 32h4v4h-4zM86 55h4v4h-4zM86 65h4v4h-4z" />
        <path fill="var(--accent)" d="M86 43h4v4h-4z" />
        <path
          stroke="var(--welcome-preview-muted)" strokeWidth="2.5" strokeLinecap="round"
          d="M96 34h66m-66 11h75m-75 12h56m-56 10h65M213 34h19m-19 11h16m-16 12h19m-19 10h13"
        />
      </>
    ) : (
      <>
        <path
          fill="var(--welcome-preview-sidebar)"
          stroke="var(--welcome-preview-line)"
          d="M82 32h50v34H82zM140 32h50v34h-50zM198 32h50v34h-50zM82 73h50v34H82zM140 73h50v34h-50zM198 73h50v34h-50z"
        />
        <path
          fill="var(--welcome-preview-muted)"
          d="M87 37h40v24H87zM203 37h40v24h-40zM87 78h40v24H87zM145 78h40v24h-40zM203 78h40v24h-40z"
        />
        <rect x="145" y="37" width="40" height="24" rx="1" fill="var(--accent)" />
      </>
    )}
  </svg>
);
