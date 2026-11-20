// App shell wiring: renders the grouped shell model into the top-level layout.
import { AppOverlays, AppShellLayout, AppWindowFrame } from "@/components";
import { useAppShellModel } from "@/hooks";
import "@/styles/app.scss";

const App = () => {
  const { navigation, view, selection, preview, overlays, paneActions, fileDrop } = useAppShellModel();

  return (
    <div className="app-shell" data-preview={preview.open ? "true" : "false"}>
      <AppShellLayout
        topstack={navigation.topstackProps}
        content={{
          paneActions,
          fileDrop,
          layoutClass: view.layoutClass,
          folderBusy: view.folderBusy,
          sidebarOpen: navigation.sidebarOpen,
          sidebarProps: navigation.sidebarProps,
          mainRef: view.mainRef,
          onContextMenu: view.onContextMenu,
          onContextMenuDown: view.onContextMenuDown,
          fileViewProps: view.fileViewProps,
          onOpenGallery: view.onOpenGallery,
        }}
        statusbar={{
          statusBar: selection.statusBar,
          hidden: selection.statusHidden,
        }}
      />
      <AppOverlays {...overlays} />
      <AppWindowFrame />
    </div>
  );
};

export default App;
