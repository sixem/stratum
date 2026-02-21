// Context-menu section container for App.tsx.
// Bundles active-state derivation and menu handlers/items in one place.
import { useAppContextMenus } from "./useAppContextMenus";

type UseAppContextMenuSectionOptions = Parameters<typeof useAppContextMenus>[0];

export const useAppContextMenuSection = ({
  contextMenu,
  ...options
}: UseAppContextMenuSectionOptions) => {
  const contextMenuState = useAppContextMenus({
    contextMenu,
    ...options,
  });

  return {
    contextMenuActive: Boolean(contextMenu),
    ...contextMenuState,
  };
};
