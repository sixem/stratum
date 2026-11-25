import { lazy, Suspense } from "react";
import type { TerminalSession } from "@/types/tabs";

const PowerShell = lazy(() => import("./PowerShell"));

export function TerminalPane({ terminal, autoFocus = true }: { terminal: TerminalSession; autoFocus?: boolean }) {
  return <Suspense fallback={null}><PowerShell key={terminal.key} terminal={terminal} autoFocus={autoFocus} /></Suspense>;
}
