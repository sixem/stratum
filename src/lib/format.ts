const sizeUnits = ["B", "KB", "MB", "GB", "TB"];
const countFormatter = new Intl.NumberFormat();

export function formatBytes(value: number | null) {
  if (value === null) return "...";
  if (value <= 0) return "0 B";
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < sizeUnits.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size < 10 && unitIndex > 0 ? 1 : 0;
  return `${size.toFixed(decimals)} ${sizeUnits[unitIndex]}`;
}

export function formatCount(value: number) {
  return countFormatter.format(value);
}

export function formatPercent(value: number, total: number, decimals = 0) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const percent = (value / total) * 100;
  return `${percent.toFixed(decimals)}%`;
}

export function formatDate(epochMs: number | null) {
  if (epochMs === null) return "-";
  const date = new Date(epochMs);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
