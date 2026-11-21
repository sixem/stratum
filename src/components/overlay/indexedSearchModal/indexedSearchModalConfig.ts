// Timing and result-size choices for the indexed-search modal.
//
// These constants are intentionally local to the modal because they describe
// UI responsiveness rather than a backend contract.
export const INDEXED_SEARCH_MODAL_POLL_MS = 3000;
export const INDEXED_SEARCH_DRIVE_INFO_REFRESH_MS = 15000;
export const INDEXED_SEARCH_QUERY_DEBOUNCE_MS = 140;
export const INDEXED_SEARCH_PAGE_SIZE = 64;
export const INDEXED_SEARCH_RESULT_HEIGHT = 48;
export const INDEXED_SEARCH_RESULT_SPACING = 3;
export const INDEXED_SEARCH_RESULT_INSET = 6;
export const INDEXED_SEARCH_RESULT_STRIDE = INDEXED_SEARCH_RESULT_HEIGHT + INDEXED_SEARCH_RESULT_SPACING;
