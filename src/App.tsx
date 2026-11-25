// App shell wiring: renders the grouped shell model into the top-level layout.
import { useState } from "react";
import { AppOverlays, AppShellLayout, AppWindowFrame } from "@/components";
import { WelcomeSetup } from "@/components/overlay/welcome/WelcomeSetup";
import { useAppShellModel } from "@/hooks";
import { releaseInputFocusOnEscape } from "@/hooks/ui/inputs/inputFocus";
import { finishWelcome, type WelcomeSettings } from "@/modules/welcome";
import "@/styles/app.scss";

const App = ({ showWelcome }: { showWelcome: boolean }) => {
  const [welcomeOpen, setWelcomeOpen] = useState(showWelcome);
  const { navigation, view, selection, preview, overlays, paneActions, fileDrop } =
    useAppShellModel(welcomeOpen);
  const closeWelcome = (settings?: WelcomeSettings) => {
    finishWelcome(settings);
    setWelcomeOpen(false);
  };

  return (
    <div className="app-shell" data-preview={preview.open ? "true" : "false"}
      onKeyDown={event => { releaseInputFocusOnEscape(event.nativeEvent, view.mainRef.current); }}>
      <AppShellLayout
        topstack={navigation.topstackProps}
        content={{
          paneActions,
          fileDrop,
          layoutClass: view.layoutClass,
          folderBusy: view.folderBusy,
          folderFailed: view.folderFailed,
          onRetryFolder: view.onRetryFolder,
          sidebarOpen: navigation.sidebarOpen,
          sidebarProps: navigation.sidebarProps,
          activeTabId: view.activeTabId,
          mainRef: view.mainRef,
          onContextMenu: view.onContextMenu,
          onContextMenuDown: view.onContextMenuDown,
          fileViewProps: view.fileViewProps,
          bottomMenu: view.bottomMenu,
          bottomCommandsBlocked: view.bottomCommandsBlocked,
          bottomPreview: view.bottomPreview,
        }}
        statusbar={{
          statusBar: selection.statusBar,
        }}
      />
      {welcomeOpen ? <WelcomeSetup onFinish={closeWelcome} /> : null}
      <AppOverlays {...overlays} />
      <AppWindowFrame />
    </div>
  );
};

export default App;
