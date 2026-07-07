// Dedicated modal shell for indexed path search.
//
// The shell keeps global overlay behavior in one place and delegates the
// backend, selection, and list-rendering responsibilities to focused modules in
// indexedSearchModal/.
import { useEffect, useId, useRef } from "react";

import { FilterIcon } from "@/components/icons";
import { IndexedSearchDriveList } from "@/components/overlay/indexedSearchModal/IndexedSearchDriveList";
import { IndexedSearchResultsList } from "@/components/overlay/indexedSearchModal/IndexedSearchResultsList";
import { IndexedSearchSelectionDetail } from "@/components/overlay/indexedSearchModal/IndexedSearchSelectionDetail";
import { useIndexedSearchResults } from "@/components/overlay/indexedSearchModal/useIndexedSearchResults";
import { useIndexedSearchSelection } from "@/components/overlay/indexedSearchModal/useIndexedSearchSelection";
import { useIndexedSearchStatus } from "@/components/overlay/indexedSearchModal/useIndexedSearchStatus";
import { OverlayPanelHeader } from "@/components/overlay/OverlayPanelHeader";
import { PressButton } from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks";
import {
  formatCount,
  formatIndexedSearchServiceState,
} from "@/lib";
import { useIndexedSearchUiStore } from "@/modules";

export const IndexedSearchModal = () => {
  const open = useIndexedSearchUiStore((state) => state.open);
  const query = useIndexedSearchUiStore((state) => state.query);
  const setQuery = useIndexedSearchUiStore((state) => state.setQuery);
  const closeModal = useIndexedSearchUiStore((state) => state.closeModal);

  const titleId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldCloseRef = useRef(false);

  const {
    driveStatuses,
    handleRebuildDrive,
    rebuildingDrivePath,
    serviceStatus,
    shouldPollSnapshot,
    statusError,
    statusLoading,
    visibleDriveInfo,
  } = useIndexedSearchStatus(open);
  const {
    debouncedQuery,
    results,
    resultsError,
    resultsViewportRef,
    shownResultCount,
  } = useIndexedSearchResults({
    open,
    query,
    shouldPollSnapshot,
  });
  const {
    handleOpenSelectedResult,
    handleQueryKeyDown,
    resultRefs,
    selectedDrive,
    selectedResult,
    selectedResultMeta,
    selection,
    selectionError,
    selectDrive,
    selectResult,
  } = useIndexedSearchSelection({
    driveStatuses,
    open,
    results,
  });

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: inputRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }

      if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [closeModal, open]);

  if (!open) return null;

  const trimmedQuery = debouncedQuery.trim();
  const totalIndexedEntries = driveStatuses.reduce((total, status) => {
    return total + Math.max(0, status.entryCount ?? 0);
  }, 0);
  const serviceMetaLabel =
    statusLoading || serviceStatus == null
      ? "Loading"
      : serviceStatus.activityLabel
        ? serviceStatus.activityLabel
        : totalIndexedEntries > 0
          ? `${formatCount(totalIndexedEntries)} indexed entries`
          : driveStatuses.length > 0
            ? `${driveStatuses.length} indexed drives`
            : formatIndexedSearchServiceState(serviceStatus);
  const driveStatusNotice = driveStatuses.length > 0 ? statusError : null;

  return (
    <div
      className="indexed-search-modal"
      data-open="true"
      aria-hidden="false"
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
          titleClassName="indexed-search-title"
          subtitleClassName="indexed-search-subtitle"
          title="Indexed Search"
          titleId={titleId}
          subtitle="Search indexed files and folders by name."
          actions={
            <PressButton
              type="button"
              className="btn ghost indexed-search-close"
              onClick={closeModal}
            >
              Close
            </PressButton>
          }
        />

        <div className="indexed-search-field">
          <div className="indexed-search-searchbox">
            <div className="indexed-search-searchbox-row">
              <div className="indexed-search-searchbox-icon" aria-hidden="true">
                <FilterIcon className="indexed-search-searchbox-icon-svg" />
              </div>
              <input
                ref={inputRef}
                className="indexed-search-input"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search indexed files and folders by name"
                aria-label="Indexed search query"
                spellCheck={false}
                autoComplete="off"
                onKeyDown={handleQueryKeyDown}
              />
            </div>
            <div className="indexed-search-searchbox-hint" aria-live="polite">
              <div className="indexed-search-searchbox-hint-left">{serviceMetaLabel}</div>
              <div className="indexed-search-searchbox-hint-right">
                Wildcards * and ? supported
              </div>
            </div>
          </div>
        </div>

        <div className="indexed-search-body">
          <IndexedSearchResultsList
            onOpenResult={(path) => {
              void handleOpenSelectedResult(path);
            }}
            onSelectResult={selectResult}
            resultRefs={resultRefs}
            results={results}
            resultsError={resultsError}
            resultsViewportRef={resultsViewportRef}
            selection={selection}
            shownResultCount={shownResultCount}
            trimmedQuery={trimmedQuery}
          />

          <section className="indexed-search-drives" aria-label="Indexed search selection and drives">
            {driveStatusNotice ? (
              <div className="indexed-search-section-note" role="status">
                {driveStatusNotice}
              </div>
            ) : null}

            <div className="indexed-search-section-body">
              <IndexedSearchSelectionDetail
                rebuildingDrivePath={rebuildingDrivePath}
                selectedDrive={selectedDrive}
                selectedResult={selectedResult}
                selectedResultMeta={selectedResultMeta}
                selectionError={selectionError}
                visibleDriveInfo={visibleDriveInfo}
                onOpenResult={(path) => {
                  void handleOpenSelectedResult(path);
                }}
                onRebuildDrive={(drivePath) => {
                  void handleRebuildDrive(drivePath);
                }}
              />

              <IndexedSearchDriveList
                driveStatuses={driveStatuses}
                onSelectDrive={selectDrive}
                open={open}
                selection={selection}
                statusLoading={statusLoading}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
