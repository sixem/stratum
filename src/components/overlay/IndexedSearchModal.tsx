// Dedicated modal shell for indexed path search.
//
// The shell keeps global overlay behavior in one place and delegates the
// backend, selection, and list-rendering responsibilities to focused modules in
// indexedSearchModal/.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";

import { BinocularsIcon, TabCloseIcon } from "@/components/icons";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { buildIndexedSearchGallery } from "@/components/overlay/indexedSearchModal/buildIndexedSearchGallery";
import { IndexedSearchDriveList } from "@/components/overlay/indexedSearchModal/IndexedSearchDriveList";
import { IndexedSearchResultsList } from "@/components/overlay/indexedSearchModal/IndexedSearchResultsList";
import { IndexedSearchSelectionDetail } from "@/components/overlay/indexedSearchModal/IndexedSearchSelectionDetail";
import { useIndexedSearchResults } from "@/components/overlay/indexedSearchModal/useIndexedSearchResults";
import { useIndexedSearchResultMenu, type IndexedSearchMenuActions } from "@/components/overlay/indexedSearchModal/useIndexedSearchResultMenu";
import { useIndexedSearchSelection } from "@/components/overlay/indexedSearchModal/useIndexedSearchSelection";
import { useIndexedSearchStatus } from "@/components/overlay/indexedSearchModal/useIndexedSearchStatus";
import { OverlayPanelHeader } from "@/components/overlay/OverlayPanelHeader";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks";
import type { PreviewGallerySource, PreviewSourceBindings } from "@/hooks/ui/view/useQuickPreview";
import { formatCount, formatIndexedSearchServiceState, isIndexedDriveActiveState } from "@/lib";
import { useIndexedSearchUiStore } from "@/modules";

export type IndexedSearchModalProps = {
  menuActions: IndexedSearchMenuActions;
  preview: PreviewSourceBindings;
  previewOpen: boolean;
  onOpenGallery: (path: string, gallery: PreviewGallerySource) => void;
};

export const IndexedSearchModal = ({ menuActions, preview, previewOpen, onOpenGallery }: IndexedSearchModalProps) => {
  const open = useIndexedSearchUiStore((state) => state.open);
  const query = useIndexedSearchUiStore((state) => state.query);
  const setQuery = useIndexedSearchUiStore((state) => state.setQuery);
  const closeModal = useIndexedSearchUiStore((state) => state.closeModal);
  // Keep the query and result list mounted behind the gallery.
  const visible = open && !previewOpen;

  const titleId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const shouldCloseRef = useRef(false);
  const returningFromGalleryRef = useRef(false);
  const openFolderInNewTab = useCallback((path: string) => {
    closeModal();
    menuActions.onOpenFolderNewTab(path);
  }, [closeModal, menuActions.onOpenFolderNewTab]);

  const {
    driveStatuses,
    handleRebuildDrive,
    rebuildingDrivePath,
    serviceStatus,
    statusError,
    statusLoading,
    visibleDriveInfo,
  } = useIndexedSearchStatus(open);
  const hasSavedDrive = driveStatuses.some(({ state }) => state === "saved" || state === "ready");
  const hasSearchableDrive = (serviceStatus?.searchableDriveCount ?? Number(hasSavedDrive)) > 0;
  const checkingIndex = statusLoading || serviceStatus?.state === "starting";
  const buildingIndex = serviceStatus?.state === "scanning" || driveStatuses.some(
    ({ state }) => isIndexedDriveActiveState(state) || state === "rescanrequired",
  );
  const indexUnavailable = serviceStatus?.state === "disabled" || serviceStatus?.state === "error";
  const catalogPending = !indexUnavailable && !hasSearchableDrive && (checkingIndex || buildingIndex);
  const {
    results,
    resultsError,
    resultsViewportRef,
    searching,
    trimmedQuery,
  } = useIndexedSearchResults({
    catalogPending,
    catalogRevision: serviceStatus?.catalogRevision,
    open,
    query,
  });
  const {
    handleOpenSelectedResult,
    handleSearchKeyDown,
    resultRefs,
    selectedDrive,
    selectedResult,
    selectedResultMeta,
    selectionError,
    selectDrive,
    selectResult,
  } = useIndexedSearchSelection({
    driveStatuses,
    open,
    results,
    onOpenFolder: openFolderInNewTab,
  });

  const gallery = useMemo(() => buildIndexedSearchGallery(results, selectResult), [results, selectResult]);
  const openGallery = useCallback((path: string) => {
    if (gallery.entryByPath.has(path)) onOpenGallery(path, gallery);
  }, [gallery, onOpenGallery]);
  const resultMenu = useIndexedSearchResultMenu({
    visible,
    results,
    actions: menuActions,
    closeSearch: closeModal,
    openResult: handleOpenSelectedResult,
    openGallery,
    selectResult,
  });
  const resultMenuOpen = resultMenu.props.open;
  const selectedPath = selectedResult?.path;

  useLayoutEffect(() => {
    const paneRoot = panelRef.current;
    const filesRoot = resultsViewportRef.current;
    if (!visible || !paneRoot || !filesRoot || !gallery.items.length) return;
    return preview.registerSource({
      gallery,
      paneRoot,
      filesRoot,
      isCurrent: () => !resultMenuOpen && modalRef.current?.inert === false,
      getSelectedPath: () => selectedPath,
      shortcutInput: inputRef.current ?? undefined,
    });
  }, [gallery, preview, resultMenuOpen, resultsViewportRef, selectedPath, visible]);

  useModalFocusTrap({
    open: visible,
    containerRef: panelRef,
    initialFocusRef: inputRef,
  });

  useLayoutEffect(() => {
    const shouldRestoreResult = visible && returningFromGalleryRef.current;
    returningFromGalleryRef.current = open && previewOpen;
    if (!shouldRestoreResult || !selectedPath) return;

    // Gallery navigation updates the selection even while the result list is hidden.
    const selectedRow = resultRefs.current.find((row) => row?.dataset.path === selectedPath);
    selectedRow?.focus({ preventScroll: true });
    selectedRow?.scrollIntoView({ block: "nearest" });
  }, [open, previewOpen, resultRefs, selectedPath, visible]);

  useEffect(() => {
    if (!visible) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (resultMenuOpen || modalRef.current?.inert) return;
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [closeModal, resultMenuOpen, visible]);

  if (!open) return null;

  const totalIndexedEntries = driveStatuses.reduce((total, status) => {
    return total + Math.max(0, status.entryCount ?? 0);
  }, 0);
  const serviceError = serviceStatus?.state === "error"
    ? serviceStatus.activityLabel?.trim() || "Indexed search is unavailable."
    : null;
  const indexError = statusError ?? serviceError;
  const serviceMetaLabel =
    indexUnavailable
      ? formatIndexedSearchServiceState(serviceStatus)
      : catalogPending
        ? checkingIndex ? "Checking index…" : "Building index"
        : totalIndexedEntries > 0
          ? `${formatCount(totalIndexedEntries)} indexed entries`
          : hasSearchableDrive || hasSavedDrive
            ? "Index ready"
            : formatIndexedSearchServiceState(serviceStatus);

  return (
    <div
      className="indexed-search-modal"
      ref={modalRef}
      hidden={!visible}
      data-open="true"
      onMouseDown={(event) => {
        shouldCloseRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (shouldCloseRef.current) {
          closeModal();
        }
        shouldCloseRef.current = false;
      }}
    >
      <div
        className="indexed-search-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <OverlayPanelHeader
          className="indexed-search-header"
          title="Indexed Search"
          titleId={titleId}
          actions={
            <PressButton
              type="button"
              className="btn ghost"
              onClick={closeModal}
            >
              Close
            </PressButton>
          }
        />

        <div className="indexed-search-field">
          <div className="indexed-search-searchbox">
            <BinocularsIcon className="indexed-search-searchbox-icon" />
            <input
              ref={inputRef}
              type="search"
              className="indexed-search-input"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search files and folders by name…"
              aria-label="Search indexed files and folders by name"
              spellCheck={false}
              autoComplete="off"
              onKeyDown={handleSearchKeyDown}
            />
            {query.length > 0 ? (
              <TooltipWrapper text="Clear search">
                <PressButton
                  type="button"
                  className="indexed-search-clear"
                  aria-label="Clear search"
                  pressOnPointerDown={false}
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  <TabCloseIcon />
                </PressButton>
              </TooltipWrapper>
            ) : null}
          </div>
        </div>

        <div className="indexed-search-body">
          <IndexedSearchResultsList
            catalogPending={catalogPending}
            onResultKeyDown={handleSearchKeyDown}
            onOpenResult={handleOpenSelectedResult}
            onOpenContextMenu={resultMenu.openAt}
            onPreviewPress={preview.onPress}
            onSelectResult={selectResult}
            resultRefs={resultRefs}
            results={results}
            resultsError={resultsError}
            resultsViewportRef={resultsViewportRef}
            searching={searching}
            selectedPath={selectedPath}
            trimmedQuery={trimmedQuery}
          />

          <aside className="indexed-search-sidebar" aria-label="Details and drives">
            <IndexedSearchSelectionDetail
              rebuildingDrivePath={rebuildingDrivePath}
              selectedDrive={selectedDrive}
              selectedResult={selectedResult}
              selectedResultMeta={selectedResultMeta}
              selectionError={selectionError}
              visibleDriveInfo={visibleDriveInfo}
              onOpenResult={handleOpenSelectedResult}
              onRebuildDrive={(drivePath) => {
                void handleRebuildDrive(drivePath);
              }}
            />

            {indexError ? (
              <div className="indexed-search-section-note" role="status">
                {indexError}
              </div>
            ) : null}

            <IndexedSearchDriveList
              driveStatuses={driveStatuses}
              onSelectDrive={selectDrive}
              selectedDrivePath={selectedDrive?.drivePath}
              checkingIndex={checkingIndex}
            />
          </aside>
        </div>

        <footer className="indexed-search-footer">
          <TooltipWrapper text={serviceMetaLabel}>
            <span className="indexed-search-service-status tnum">{serviceMetaLabel}</span>
          </TooltipWrapper>
          <div className="indexed-search-shortcuts">
            <span><kbd aria-label="Up arrow">↑</kbd> <kbd aria-label="Down arrow">↓</kbd> Select</span>
            <span><kbd>Enter</kbd> Open</span>
          </div>
        </footer>
        <ContextMenu {...resultMenu.props} scrollContainer={resultsViewportRef} />
      </div>
    </div>
  );
};
