// The visible label and description also provide the text for settings search.
import { createContext, useContext, useId } from "react";
import type { ReactNode } from "react";

export type SettingsItemText = {
  label: string;
  description: string;
  keywords?: string;
  requiresAutoGrid?: boolean;
  requiresMoveHistory?: boolean;
};

export const SettingsSearchMatches = createContext<ReadonlySet<SettingsItemText> | null>(null);

export const SettingsGroup = ({ id, title, items, children }: {
  id: string;
  title: string;
  items: readonly SettingsItemText[];
  children: ReactNode;
}) => {
  const matches = useContext(SettingsSearchMatches);
  if (matches && !items.some((item) => matches.has(item))) return null;
  return (
    <section className="settings-section" id={id} data-settings-group={title}>
      <div className="settings-section-title">{title}</div>
      {children}
    </section>
  );
};

type SettingsItemProps = {
  item: SettingsItemText;
  labelFor?: string;
  descriptionId?: string;
  labelDetail?: ReactNode;
  details?: ReactNode;
  className?: string;
  children: ReactNode;
};

export const SettingsItem = ({
  item, labelFor, descriptionId, labelDetail, details, className, children,
}: SettingsItemProps) => {
  const matches = useContext(SettingsSearchMatches);
  if (matches && !matches.has(item)) return null;

  return (
    <div className={className ? `settings-item ${className}` : "settings-item"}>
      <div>
        {labelFor ? (
          <label className="settings-label" htmlFor={labelFor}>{item.label}</label>
        ) : labelDetail ? (
          <div className="settings-label settings-label-row">
            <span>{item.label}</span>
            {labelDetail}
          </div>
        ) : (
          <div className="settings-label">{item.label}</div>
        )}
        <div className="settings-desc" id={descriptionId}>{item.description}</div>
        {details}
      </div>
      {children}
    </div>
  );
};

type SettingsToggleItemProps = {
  item: SettingsItemText;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export const SettingsToggleItem = ({ item, checked, onChange }: SettingsToggleItemProps) => {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <SettingsItem item={item} labelFor={id} descriptionId={descriptionId}>
      <label className="settings-toggle">
        <input
          type="checkbox"
          id={id}
          aria-describedby={descriptionId}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </SettingsItem>
  );
};
