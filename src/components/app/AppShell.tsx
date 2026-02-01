// Top-level app shell layout that stitches together all major UI regions.
import type { ComponentProps } from "react";
import { AppOverlays } from "./AppOverlays";
import { AppStatusbar } from "./AppStatusbar";
import { AppLayout } from "./AppLayout";

type AppShellProps = {
  layout: ComponentProps<typeof AppLayout>;
  statusbar: ComponentProps<typeof AppStatusbar>;
  overlays: ComponentProps<typeof AppOverlays>;
};

export const AppShell = ({ layout, statusbar, overlays }: AppShellProps) => {
  return (
    <div className="app-shell">
      <AppLayout {...layout} />
      <AppStatusbar {...statusbar} />
      <AppOverlays {...overlays} />
    </div>
  );
};
