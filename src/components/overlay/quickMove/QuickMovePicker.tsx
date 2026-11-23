// Pick an indexed folder to move the captured selection into.
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { LibraryIcon } from "@/components/icons";
import { DropdownSelect, PressButton } from "@/components/primitives";
import type { DropdownGroup } from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks/ui/app/useModalFocusTrap";
import { toMessage } from "@/lib/fsUtils";
import { getQuickMoveDriveRoot } from "@/modules/quickMovePreferences";
import { getQuickMovePreferences, toggleQuickMoveFavorite, updateQuickMovePreferences, useQuickMovePreferences } from "@/modules/quickMoveStore";
import { DialogCloseButton } from "../DialogCloseButton";
import { OverlayPanelHeader } from "../OverlayPanelHeader";
import { TooltipWrapper } from "../Tooltip";
import { useIndexedSearchStatus } from "../indexedSearchModal/useIndexedSearchStatus";
import { QuickMoveResults, quickMoveResultId } from "./QuickMoveResults";
import { buildQuickMoveDestinations } from "./quickMoveDestinations";
import type { QuickMoveDestination } from "./quickMoveDestinations";
import { useQuickMoveFolderSearch } from "./useQuickMoveFolderSearch";
import type { QuickMoveSearch } from "./useQuickMoveFolderSearch";

export type QuickMovePickerProps = {
  workspaceId: string | null;
  itemCount: number;
  recentPaths: readonly string[];
  onSelectPath: (path: string) => Promise<string | undefined>;
  onClose: () => void;
  isDestinationDisabled?: (path: string) => boolean;
};

const DEPTH_OPTIONS = Array.from({ length: 10 }, (_, index) => {
  const value = index + 1;
  return { value: String(value), label: value === 1 ? "Top" : `Up to ${value}` };
});

const isComposing = ({ nativeEvent }: KeyboardEvent) => nativeEvent.isComposing || nativeEvent.keyCode === 229;

export const QuickMovePicker = ({
  workspaceId, itemCount, recentPaths, onSelectPath, onClose, isDestinationDisabled,
}: QuickMovePickerProps) => {
  const titleId = useId();
  const resultsId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const outsidePress = useRef(false);
  const pendingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [cursor, setCursor] = useState<{ scope: QuickMoveSearch; key: string; keyboard: boolean } | null>(null);
  const [selectionError, setSelectionError] = useState<{ scope: QuickMoveSearch; message: string } | null>(null);
  const { favorites, driveRoots, maxDepth } = useQuickMovePreferences(workspaceId);
  const { serviceStatus, driveStatuses, visibleDriveInfo, statusLoading, statusError } = useIndexedSearchStatus(true);
  useModalFocusTrap({ open: true, containerRef: panelRef, initialFocusRef: inputRef });

  const indexEnabled = serviceStatus?.state !== "disabled";
  const indexedRoots = useMemo(() => {
    if (!indexEnabled) return [];
    const roots = new Set<string>();
    for (const status of driveStatuses) {
      const root = status.searchable ? getQuickMoveDriveRoot(status.drivePath) : null;
      if (root) roots.add(root);
    }
    return [...roots].sort();
  }, [driveStatuses, indexEnabled]);
  const driveLabels = useMemo(() => new Map(visibleDriveInfo?.map(({ path, label }) => (
    [getQuickMoveDriveRoot(path), label] as const
  ))), [visibleDriveInfo]);
  const availableScopes = indexedRoots.filter((root) => driveRoots === null || driveRoots.includes(root)).join("|");
  const trimmedQuery = query.trim();
  const scope = useMemo<QuickMoveSearch>(() => ({
    search: trimmedQuery,
    scopeRoots: availableScopes ? availableScopes.split("|") : [],
    maxDepth,
  }), [availableScopes, maxDepth, trimmedQuery]);
  const depthGroups = useMemo<DropdownGroup[]>(() => [{
    id: "depth",
    options: maxDepth != null && (maxDepth < 1 || maxDepth > DEPTH_OPTIONS.length)
      ? [{ value: String(maxDepth), label: `Up to ${maxDepth}` }, ...DEPTH_OPTIONS]
      : DEPTH_OPTIONS,
  }], [maxDepth]);
  const search = useQuickMoveFolderSearch(scope, indexEnabled, serviceStatus?.catalogRevision);
  const destinations = useMemo(() => buildQuickMoveDestinations({
    favoritePaths: favorites, recentPaths, matches: search.matches, scope, isDestinationDisabled,
  }), [favorites, isDestinationDisabled, recentPaths, scope, search.matches]);
  const scopedCursor = cursor?.scope === scope ? cursor : null;
  const cursorIndex = scopedCursor ? destinations.findIndex((row) => row.key === scopedCursor.key && !row.disabled) : -1;
  const activeIndex = cursorIndex >= 0 ? cursorIndex : destinations.findIndex((row) => !row.disabled);
  const active = destinations[activeIndex];

  useLayoutEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [scope]);

  const toggleDrive = (root: string) => {
    const selected = getQuickMovePreferences(workspaceId).driveRoots ?? indexedRoots;
    updateQuickMovePreferences(workspaceId, {
      driveRoots: selected.includes(root) ? selected.filter((item) => item !== root) : [...selected, root],
    });
    inputRef.current?.focus({ preventScroll: true });
  };

  const choose = async (destination: QuickMoveDestination) => {
    if (pendingRef.current || destination.disabled) return;
    setSelectionError(null);
    pendingRef.current = true;
    inputRef.current?.focus({ preventScroll: true });
    setPending(true);
    try {
      const message = await onSelectPath(destination.path);
      if (message) setSelectionError({ scope, message });
    } catch (error) {
      setSelectionError({ scope, message: toMessage(error, "Couldn't move to this folder.") });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const handleSearchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || isComposing(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (active && !search.loading) void choose(active);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (pendingRef.current) return;

    const direction = event.key === "ArrowDown" ? 1 : -1;
    for (let index = activeIndex + direction; index >= 0 && index < destinations.length; index += direction) {
      const destination = destinations[index];
      if (destination.disabled) continue;
      setCursor({ scope, key: destination.key, keyboard: true });
      return;
    }
    if (direction === 1 && search.hasMore) search.loadMore();
  };

  const error = (selectionError?.scope === scope && selectionError.message) || search.error || statusError;
  const emptyMessage = (() => {
    if (!indexEnabled) return "Enable Indexed Search to use Quick Move.";
    if (statusLoading && !indexedRoots.length) return "Checking indexed drives…";
    if (!indexedRoots.length) return "No indexed drives are ready yet.";
    if (!scope.scopeRoots.length) return "Select a drive to find folders.";
    if (!trimmedQuery) return "Type a folder name or path.";
    if (search.loading) return "Searching indexed folders…";
    return search.error ? "" : "No matching folders.";
  })();

  return (
    <div className="quick-move-modal" data-open="true"
      onMouseDown={(event) => { outsidePress.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (outsidePress.current && event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className="quick-move-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || isComposing(event)) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}>
        <OverlayPanelHeader title="Quick Move" titleId={titleId} className="quick-move-header" preserveFocusOnMouseDown
          actions={<><span className="quick-move-count">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
            <DialogCloseButton onClose={onClose} /></>} />
        <div className="quick-move-controls">
          <div className="quick-move-searchbox">
            <LibraryIcon className="quick-move-search-icon" />
            <input ref={inputRef} className="quick-move-input" type="search" role="combobox"
              aria-label="Find an indexed folder" aria-autocomplete="list" aria-haspopup="grid"
              aria-expanded="true" aria-controls={resultsId}
              aria-activedescendant={active ? quickMoveResultId(resultsId, activeIndex) : undefined}
              placeholder="Find a folder…" autoComplete="off" spellCheck={false} value={query} readOnly={pending}
              onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeys} />
          </div>
          <div className="quick-move-filters">
            <div className="quick-move-drives" role="group" aria-label="Indexed drives">
              {indexedRoots.map((root) => (
                <TooltipWrapper key={root} text={driveLabels.get(root) || root}>
                  <PressButton type="button" className="quick-move-drive" pressOnPointerDown={false}
                    aria-pressed={scope.scopeRoots.includes(root)} disabled={pending} onClick={() => toggleDrive(root)}>
                    {root.slice(0, 2)}
                  </PressButton>
                </TooltipWrapper>
              ))}
            </div>
            <div className="quick-move-depth">
              <span>Depth</span>
              <DropdownSelect ariaLabel="Maximum folder depth" groups={depthGroups} placeholder="Any"
                value={maxDepth == null ? null : String(maxDepth)} disabled={pending}
                onChange={(value) => updateQuickMovePreferences(workspaceId, { maxDepth: value == null ? null : Number(value) })} />
            </div>
          </div>
        </div>
        <QuickMoveResults destinations={destinations} viewportRef={viewportRef} resultsId={resultsId}
          activeIndex={activeIndex} keyboardPath={scopedCursor?.keyboard ? scopedCursor.key : null}
          busy={pending} emptyMessage={emptyMessage} autoPage={search.hasMore && !search.loadingMore && !search.error && !pending}
          onLoadMore={search.loadMore} onChoose={(destination) => void choose(destination)}
          onActivate={({ key, disabled }) => { if (!pendingRef.current && !disabled) setCursor({ scope, key, keyboard: false }); }}
          onToggleFavorite={({ path }) => toggleQuickMoveFavorite(workspaceId, path)} />
        <div className="quick-move-footer">
          {error ? <>
            <span className="quick-move-error" role="alert">{error}</span>
            {search.error ? <PressButton type="button" className="quick-move-retry" onClick={search.retry}>Retry</PressButton> : null}
          </> : pending ? <span role="status">Checking destination…</span>
            : search.loadingMore ? <span role="status">Loading more folders…</span>
              : search.loading && destinations.length ? <span role="status">Searching indexed folders…</span>
                : <><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Move</span></>}
        </div>
      </div>
    </div>
  );
};
