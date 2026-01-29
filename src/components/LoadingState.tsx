// Simple skeleton rows for placeholder content.
type LoadingStateProps = {
  rows?: number;
};

export const LoadingState = ({ rows = 6 }: LoadingStateProps) => {
  return (
    <div className="loading-state" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={`skeleton-${index}`} className="skeleton-row">
          <div className="skeleton-block wide" />
          <div className="skeleton-block" />
          <div className="skeleton-block" />
        </div>
      ))}
    </div>
  );
};
