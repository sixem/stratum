// Keep a listing only while refreshing the same host, session and folder.
export type RemoteListingResult<T> = { location: string; request: string; data?: T; error?: string };

export function selectRemoteListing<T>(result: RemoteListingResult<T> | null, location: string, request: string) {
  const matching = result?.location === location && result.request === request ? result : null;
  return {
    data: matching ? matching.data : result?.location === location ? result.data : undefined,
    error: matching?.error,
  };
}
