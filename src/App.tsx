// App shell wiring: renders the grouped shell model into the top-level layout.
import { AppOverlays, AppShellLayout, AppWindowFrame } from "@/components";
import { useAppShellModel } from "@/hooks";
import { releaseInputFocusOnEscape } from "@/hooks/ui/inputs/inputFocus";
import "@/styles/app.scss";

const App = () => {
  const { navigation, view, selection, preview, overlays, paneActions, fileDrop } = useAppShellModel();

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
      <AppOverlays {...overlays} />
      <AppWindowFrame />
    </div>
  );
};

export default App;
