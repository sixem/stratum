// Reopen only the failed sources so retrying a batch never converts successful files twice.
import type { ConversionModalDraft, ConversionModalRequest } from "@/types";

export function failedConversionDraft(
  request: ConversionModalRequest,
  draft: ConversionModalDraft,
  failedSources: string[],
) {
  const failed = new Set(failedSources);
  const items = draft.items.filter(item => failed.has(item.path));
  if (!items.length) return null;
  const sourceKinds = Array.from(new Set(items.map(item => item.kind)));
  return {
    request: { ...request, items, paths: items.map(item => item.path), sourceKinds },
    draft: { ...draft, items, rules: draft.rules.filter(rule => sourceKinds.includes(rule.kind)) },
  };
}
