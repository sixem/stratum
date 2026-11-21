type MetadataLabelProps = {
  value: string | null;
  placeholder?: string;
  className?: string;
};

// Keep the value mounted so a pending label can fade when it resolves.
export const MetadataLabel = ({ value, placeholder, className }: MetadataLabelProps) => (
  <span className={className}>
    {value === null ? placeholder : null}
    <span className="metadata-label-value">{value}</span>
  </span>
);
