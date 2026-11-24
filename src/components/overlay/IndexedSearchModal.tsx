// Dedicated modal shell for indexed path search.
//
// The shell keeps global overlay behavior in one place and delegates the
// backend, selection, and list-rendering responsibilities to focused modules in
// indexedSearchModal/.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";

import { LibraryIcon, TabCloseIcon } from "@/components/icons";
import { ContextMenu } from "@/components/overlay/ContextMenu";
import { createIndexedGalleryLookup } from "@/components/overlay/indexedSearchModal/indexedSearchGallery";
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
import { FileFilterHint } from "@/components/primitives/FileFilterHint";
import { useModalFocusTrap } from "@/hooks";
import { isPlainEscape, releaseInputFocusOnEscape } from "@/hooks/ui/inputs/inputFocus";
import type { PreviewGallerySource, PreviewSourceBindings } from "@/hooks/ui/view/useQuickPreview";
import { formatCount, formatIndexedSearchServiceState, isIndexedDriveActiveState } from "@/lib";
import { useIndexedSearchUiStore } from "@/modules";
import { DialogCloseButton } from "./DialogCloseButton";

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
  const filterHintId = useId();
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
    resultIndexes,
    resultsError,
    pageError,
    refreshError,
    refreshing,
    resultsUpdated,
    refreshResults,
    scrollRestore,
    hasMore,
    loadingMore,
    loadMore,
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
    focusSelectedResult,
    copyPaths,
    registerResultRow,
    selectedDrive,
    selectedResult,
    selectedResultIndex,
    selectedResultMeta,
    selectionError,
    selectDrive,
    selectResult,
    selectResultForCopy,
  } = useIndexedSearchSelection({
    driveStatuses,
    open,
    results,
    resultIndexes,
    refreshedAnchorPath: scrollRestore?.path,
    query: trimmedQuery,
    hasMore,
    loadMore,
    resultsViewportRef,
    onOpenFolder: openFolderInNewTab,
  });

  const getGallery = useMemo(
    () => createIndexedGalleryLookup(results, resultIndexes, selectResult),
    [results, resultIndexes, selectResult],
  );
  const openGallery = useCallback((path: string) => {
    const gallery = getGallery(path);
    if (gallery) onOpenGallery(path, gallery);
  }, [getGallery, onOpenGallery]);
  const resultMenu = useIndexedSearchResultMenu({
    visible,
    results,
    actions: menuActions,
    closeSearch: closeModal,
    openResult: handleOpenSelectedResult,
    openGallery,
    selectResult,
    selectResultForCopy,
    copyPaths,
  });
  const resultMenuOpen = resultMenu.props.open;
  const selectedPath = selectedResult?.path;

  useLayoutEffect(() => {
    const paneRoot = panelRef.current;
    const filesRoot = resultsViewportRef.current;
    if (!visible || !paneRoot || !filesRoot || !results.length) return;
    return preview.registerSource({
      getGallery,
      paneRoot,
      filesRoot,
      isCurrent: () => !resultMenuOpen && modalRef.current?.inert === false,
      getSelectedPath: () => selectedPath,
      shortcutInput: inputRef.current ?? undefined,
    });
  }, [getGallery, preview, resultMenuOpen, results.length, resultsViewportRef, selectedPath, visible]);

  useModalFocusTrap({
    open: visible,
    containerRef: panelRef,
    initialFocusRef: inputRef,
  });

  useLayoutEffect(() => {
    const shouldRestoreResult = visible && returningFromGalleryRef.current;
    returningFromGalleryRef.current = open && previewOpen;
    if (!shouldRestoreResult) return;

    // Gallery navigation updates the selection even while the result list is hidden.
    focusSelectedResult();
  }, [focusSelectedResult, open, previewOpen, visible]);

  useEffect(() => {
    if (!visible) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (!isPlainEscape(event)) return;
      if (resultMenuOpen || modalRef.current?.inert) return;
      if (releaseInputFocusOnEscape(event)) return;
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
          preserveFocusOnMouseDown
          actions={<DialogCloseButton onClose={closeModal} />}
        />

        <div className="indexed-search-field">
          <div className="indexed-search-searchbox">
            <FileFilterHint id={filterHintId}><LibraryIcon className="indexed-search-searchbox-icon" /></FileFilterHint>
            <input
              ref={inputRef}
              type="search"
              className="indexed-search-input"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search files and folders…"
              aria-label="Search indexed files and folders"
              aria-describedby={filterHintId}
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
            hasMore={hasMore}
            loadingMore={loadingMore}
            loadMore={loadMore}
            onResultKeyDown={handleSearchKeyDown}
            onOpenResult={handleOpenSelectedResult}
            onOpenContextMenu={resultMenu.openAt}
            onPreviewPress={preview.onPress}
            onSelectResult={selectResult}
            onSelectResultForCopy={selectResultForCopy}
            registerResultRow={registerResultRow}
            results={results}
            resultsError={resultsError}
            pageError={pageError}
            refreshError={refreshError}
            refreshing={refreshing}
            resultsUpdated={resultsUpdated}
            refreshResults={() => {
              if (refreshing || catalogPending) return;
              inputRef.current?.focus({ preventScroll: true });
              refreshResults(selectedResultIndex);
            }}
            scrollRestore={scrollRestore}
            resultsViewportRef={resultsViewportRef}
            searching={searching}
            selectedResultIndex={selectedResultIndex}
            copyPaths={copyPaths}
            trimmedQuery={trimmedQuery}
            visible={visible}
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
