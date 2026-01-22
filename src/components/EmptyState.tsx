// Empty state messaging for no-content views.
type EmptyStateProps = {
  title: string;
  subtitle?: string;
};

export function EmptyState({ title, subtitle }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-title">{title}</div>
      {subtitle ? <div className="empty-subtitle">{subtitle}</div> : null}
    </div>
  );
}
