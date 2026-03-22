// Builds the properties action and its separator.

import type { ContextMenuItem } from "@/types";

type BuildEntryPropertiesItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
  hasMultiplePropertyTypes: boolean;
  onOpenProperties: (paths: string[]) => void;
};

export const buildEntryPropertiesItems = ({
  actionTargets,
  hasTargets,
  hasMultiplePropertyTypes,
  onOpenProperties,
}: BuildEntryPropertiesItemsOptions): ContextMenuItem[] => [
  { kind: "divider", id: "entry-divider-properties" },
  {
    id: "entry-properties",
    label: "Properties",
    hint: hasMultiplePropertyTypes ? "Multiple types" : undefined,
    onSelect: () => {
      if (!hasTargets) return;
      onOpenProperties(actionTargets);
    },
    disabled: !hasTargets,
  },
];
