import { lazy, Suspense } from "react";
import type { Tab } from "@/types";

const PowerShell = lazy(() => import("./PowerShell"));

export function TerminalPane({ terminal }: { terminal: NonNullable<Tab["terminal"]> }) {
  return <Suspense fallback={null}><PowerShell terminal={terminal} /></Suspense>;
}
