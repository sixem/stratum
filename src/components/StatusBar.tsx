// Bottom status line for counts and messages.
type StatusBarProps = {
  message: string;
  level: "idle" | "loading" | "error";
  countLabel: string;
  selectionLabel?: string;
};

export function StatusBar({ message, level, countLabel, selectionLabel }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-count">{countLabel}</span>
        {selectionLabel ? <span className="status-selection">{selectionLabel}</span> : null}
      </div>
      <span className={`status-text ${level}`}>{message}</span>
    </footer>
  );
}
