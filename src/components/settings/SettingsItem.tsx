// The visible label and description also provide the text for settings search.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type SettingsItemText = {
  label: string;
  description: string;
  keywords?: string;
  requiresAutoGrid?: boolean;
};

export const SettingsSearchMatches = createContext<ReadonlySet<SettingsItemText> | null>(null);

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
