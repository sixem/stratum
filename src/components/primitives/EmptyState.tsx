// Empty state messaging for no-content views.
import { PressButton } from "@/components/primitives/PressButton";

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  actions?: { label: string; onClick: () => void }[];
};

export const EmptyState = ({ title, subtitle, actions }: EmptyStateProps) => {
  return (
    <div className="empty-state" role="status">
      <div className="empty-title">{title}</div>
      {subtitle ? <div className="empty-subtitle">{subtitle}</div> : null}
      {actions && actions.length > 0 ? (
        <div className="empty-actions">
          {actions.map((action) => (
            <PressButton
              key={action.label}
              type="button"
              className="empty-action"
              onClick={action.onClick}
            >
              {action.label}
            </PressButton>
          ))}
        </div>
      ) : null}
    </div>
  );
};
