import { lazy, Suspense } from "react";
import type { Tab } from "@/types";

const PowerShell = lazy(() => import("./PowerShell"));

export function TerminalPane({ terminal, autoFocus = true }: { terminal: NonNullable<Tab["terminal"]>; autoFocus?: boolean }) {
  return <Suspense fallback={null}><PowerShell terminal={terminal} autoFocus={autoFocus} /></Suspense>;
}
