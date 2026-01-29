// Bottom status line for counts and messages.
type StatusBarProps = {
  message: string;
  level: "idle" | "loading" | "error";
  countLabel: string;
  selectionLabel?: string;
};

export const StatusBar = ({
  message,
  level,
  countLabel,
  selectionLabel,
}: StatusBarProps) => {
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-count">{countLabel}</span>
        {selectionLabel ? <span className="status-selection">{selectionLabel}</span> : null}
      </div>
      <span
        className={`status-text ${level}`}
        role={level === "error" ? "alert" : "status"}
        aria-live={level === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {message}
      </span>
    </footer>
  );
};
