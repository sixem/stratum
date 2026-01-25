// Landing content shown when no folder is selected in the active tab.
import { tabLabel } from "@/lib";
import { EmptyState } from "./EmptyState";

type StartLanderProps = {
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
};

export const StartLander = ({ recentJumps, onOpenRecent }: StartLanderProps) => {
  return (
    <div className="view-lander">
      <div className="lander-panel">
        <EmptyState
          title="Start browsing"
          subtitle="Choose a location from the sidebar or enter a path above."
        />
        <div className="lander-recents">
          <div className="lander-recents-title">Recent locations</div>
          {recentJumps.length === 0 ? (
            <div className="lander-recents-empty">No jumps yet</div>
          ) : (
            <div className="lander-recents-list">
              {recentJumps.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="place lander-place"
                  onClick={() => onOpenRecent(path)}
                  title={path}
                >
                  <span className="place-name">{tabLabel(path)}</span>
                  <span className="place-path">{path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
