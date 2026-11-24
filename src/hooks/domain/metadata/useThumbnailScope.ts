// Give each grid visit or gallery strip its own interest in queued renders.
import { useCallback, useLayoutEffect, useRef } from "react";
import { closeThumbnailScope, openThumbnailScope } from "@/api/thumbs";
import type {
  RequestScopedThumbnails, ThumbnailRequest, ThumbnailScope, ThumbnailView,
} from "@/types";

type ThumbnailVisit = { scope?: Promise<ThumbnailScope> };
const openingScopes = new Map<ThumbnailView, Promise<ThumbnailScope>>();

const openScopeInOrder = (view: ThumbnailView) => {
  // IPC can complete out of order. Even across remounts, a later visit must
  // register after the previous one so the previous one cannot replace it.
  const previous = openingScopes.get(view);
  const opening = previous
    ? previous.catch(() => {}).then(() => openThumbnailScope(view))
    : openThumbnailScope(view);
  openingScopes.set(view, opening);
  const clear = () => {
    if (openingScopes.get(view) === opening) openingScopes.delete(view);
  };
  void opening.then(clear, clear);
  return opening;
};

export const useThumbnailScope = (
  view: ThumbnailView,
  viewKey: string,
  enabled: boolean,
  onRequest: RequestScopedThumbnails,
) => {
  const current = useRef<ThumbnailVisit | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const visit: ThumbnailVisit = {};
    current.current = visit;
    return () => {
      current.current = null;
      // The backend checks the token so this cannot close a newer visit.
      void visit.scope?.then(closeThumbnailScope).catch(() => {});
    };
  }, [enabled, view, viewKey]);

  return useCallback((requests: ThumbnailRequest[]) => {
    const visit = current.current;
    if (!visit) return;
    const opening = visit.scope ??= openScopeInOrder(view);
    void opening.then(scope => {
      if (current.current === visit) onRequest(requests, scope);
    }, () => {
      if (visit.scope === opening) visit.scope = undefined;
    });
  }, [onRequest, view]);
};
