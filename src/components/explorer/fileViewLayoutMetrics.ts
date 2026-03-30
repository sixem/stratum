// Reads the shared file-view sizing tokens from CSS so virtualization math and
// rendered styles stay aligned.
export type FileViewLayoutMetrics = {
  listRowHeight: number;
  listRowGap: number;
  gridCardBorder: number;
  gridCardPadding: number;
  gridCardGap: number;
  gridMetaGap: number;
  gridNameLineHeight: number;
  gridInfoLineHeight: number;
  gridIconWidthRatio: number;
  gridIconHeightRatio: number;
};

const DEFAULT_FILE_VIEW_LAYOUT_METRICS: FileViewLayoutMetrics = {
  listRowHeight: 36,
  listRowGap: 6,
  gridCardBorder: 1,
  gridCardPadding: 6,
  gridCardGap: 6,
  gridMetaGap: 6,
  gridNameLineHeight: 14,
  gridInfoLineHeight: 13,
  gridIconWidthRatio: 4,
  gridIconHeightRatio: 3,
};

const readCssNumber = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readRootNumberVar = (
  styles: CSSStyleDeclaration,
  name: string,
  fallback: number,
) => {
  return readCssNumber(styles.getPropertyValue(name), fallback);
};

export const getFileViewLayoutMetrics = (): FileViewLayoutMetrics => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return DEFAULT_FILE_VIEW_LAYOUT_METRICS;
  }

  const styles = window.getComputedStyle(document.documentElement);

  return {
    listRowHeight: readRootNumberVar(
      styles,
      "--file-view-list-row-height",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.listRowHeight,
    ),
    listRowGap: readRootNumberVar(
      styles,
      "--file-view-list-row-gap",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.listRowGap,
    ),
    gridCardBorder: readRootNumberVar(
      styles,
      "--file-view-grid-card-border",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridCardBorder,
    ),
    gridCardPadding: readRootNumberVar(
      styles,
      "--file-view-grid-card-padding",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridCardPadding,
    ),
    gridCardGap: readRootNumberVar(
      styles,
      "--file-view-grid-card-gap",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridCardGap,
    ),
    gridMetaGap: readRootNumberVar(
      styles,
      "--file-view-grid-meta-gap",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridMetaGap,
    ),
    gridNameLineHeight: readRootNumberVar(
      styles,
      "--file-view-grid-name-line-height",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridNameLineHeight,
    ),
    gridInfoLineHeight: readRootNumberVar(
      styles,
      "--file-view-grid-info-line-height",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridInfoLineHeight,
    ),
    gridIconWidthRatio: readRootNumberVar(
      styles,
      "--file-view-grid-icon-width-ratio",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridIconWidthRatio,
    ),
    gridIconHeightRatio: readRootNumberVar(
      styles,
      "--file-view-grid-icon-height-ratio",
      DEFAULT_FILE_VIEW_LAYOUT_METRICS.gridIconHeightRatio,
    ),
  };
};
