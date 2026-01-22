// Formats a short, readable list of failure messages.
export const formatFailures = (failures: string[], maxLines = 6) => {
  if (failures.length === 0) return "";
  const lines = failures.slice(0, maxLines);
  const suffix =
    failures.length > maxLines ? `\n...and ${failures.length - maxLines} more` : "";
  return `${lines.join("\n")}${suffix}`;
};
