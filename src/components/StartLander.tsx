// Landing content shown when no folder is selected in the active tab.
import { EmptyState } from "./EmptyState";

export const StartLander = () => {
  return (
    <div className="view-lander">
      <EmptyState
        title="Start browsing"
        subtitle="Choose a location from the sidebar or enter a path above."
      />
    </div>
  );
};
