// App shell wiring: renders the grouped shell model into the top-level layout.
import { AppOverlays, AppShellLayout, AppWindowFrame } from "@/components";
import { useAppShellModel } from "@/hooks";
import "@/styles/app.scss";

const App = () => {
  const { navigation, view, selection, preview, overlays } = useAppShellModel();

  return (
    <div className="app-shell" data-preview={preview.open ? "true" : "false"}>
      <AppShellLayout
        topstack={navigation.topstackProps}
        content={{
          layoutClass: view.layoutClass,
          sidebarOpen: navigation.sidebarOpen,
          sidebarProps: navigation.sidebarProps,
          mainRef: view.mainRef,
          onContextMenu: view.onContextMenu,
          onContextMenuDown: view.onContextMenuDown,
          fileViewProps: view.fileViewProps,
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
